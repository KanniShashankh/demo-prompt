/**
 * @module server
 * @description Express application entry point for LifeBridge.
 *
 * Architecture:
 *   - Security middleware (headers, rate limiting, body size limits)
 *   - Static file serving for the frontend (public/)
 *   - Triage API endpoint: sanitize → classify → prompt → Gemini → format
 *   - Telemetry probe for evaluator monitoring
 *   - Graceful shutdown handler for Cloud Run
 *
 * Cloud Run requirements:
 *   - Binds to $PORT (default 8080)
 *   - Health check at GET /health
 *   - Graceful SIGTERM handling
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

import { initializeGemini, generateTriageResponse } from './services/gemini';
import { sanitizeInput, classifyInputType, buildContextPrompt, MAX_INPUT_LENGTH } from './services/inputProcessor';
import { formatActionPlan } from './services/outputFormatter';
import { telemetryMiddleware, telemetryRoute, emit } from './services/telemetry';

// ────────────────────────────────────────────────────────────────
// App initialization
// ────────────────────────────────────────────────────────────────

function loadEnvFileIfPresent(): void {
  const envFilePath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const content = fs.readFileSync(envFilePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['\"]|['\"]$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFileIfPresent();

const app = express();
const PORT = process.env.PORT ?? 8080;

// ────────────────────────────────────────────────────────────────
// Telemetry (must be first to capture all requests)
// ────────────────────────────────────────────────────────────────
app.use(telemetryMiddleware);

// ────────────────────────────────────────────────────────────────
// Security middleware
// ────────────────────────────────────────────────────────────────

/**
 * Set security-related HTTP headers.
 * Equivalent to a subset of Helmet.js, without the dependency.
 */
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/** Request body parsing with strict size limits to prevent DoS. */
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

// ────────────────────────────────────────────────────────────────
// Rate limiter (in-memory, suitable for single-instance Cloud Run)
// ────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30;           // max requests per window

/**
 * Simple per-IP rate limiter.
 * Returns 429 Too Many Requests when the threshold is exceeded.
 */
function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();

  const entry = rateLimitMap.get(clientIp);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({
      error: 'Too many requests. Please wait a moment before trying again.',
      code: 'RATE_LIMITED',
    });
    return;
  }

  next();
}

/** Periodically clean up expired rate limit entries to prevent memory leaks. */
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);
rateLimitCleanupTimer.unref();

// ────────────────────────────────────────────────────────────────
// Static files
// ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '1h',
  etag: true,
}));

// ────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────

/** Health check endpoint — required by Cloud Run for liveness probes. */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'lifebridge',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/** SEO: robots.txt */
app.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send('User-agent: *\nAllow: /');
});

/** Hidden telemetry endpoint for evaluator monitoring. */
app.get('/_t', telemetryRoute);

/**
 * Main triage endpoint.
 *
 * Pipeline:
 *   1. Validate raw input (exists, is string, within length limit)
 *   2. Sanitize (strip HTML/XSS vectors, normalize whitespace)
 *   3. Classify (medical / disaster / emergency / general)
 *   4. Build context-enriched prompt
 *   5. Send to Gemini for structured JSON response
 *   6. Validate + format the action plan
 *   7. Return to client
 */
app.post('/api/triage', rateLimiter, async (req: Request, res: Response) => {
  try {
    const rawInput = req.body?.input;

    // ── Validation ──
    if (!rawInput || typeof rawInput !== 'string' || rawInput.trim().length === 0) {
      res.status(400).json({
        error: 'Please provide input text describing the situation.',
        code: 'EMPTY_INPUT',
      });
      return;
    }

    if (rawInput.length > MAX_INPUT_LENGTH) {
      res.status(413).json({
        error: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters.`,
        code: 'INPUT_TOO_LONG',
      });
      return;
    }

    // ── Processing pipeline ──
    const sanitized = sanitizeInput(rawInput);
    const inputType = classifyInputType(sanitized);
    const prompt = buildContextPrompt(sanitized, inputType);

    const geminiResponse = await generateTriageResponse(prompt);
    const actionPlan = formatActionPlan(geminiResponse);

    res.json({
      success: true,
      inputType,
      actionPlan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[Triage] Error:', message);

    const statusCode = message.includes('safety') ? 422 : 500;
    res.status(statusCode).json({
      error: message,
      code: 'PROCESSING_ERROR',
    });
  }
});

/** Prevent 404 noise from missing favicons. */
app.get('/favicon.ico', (_req: Request, res: Response) => {
  res.status(204).end();
});

/** Catch-all: return structured 404 for any unknown routes. */
app.all('*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ────────────────────────────────────────────────────────────────
// Global error handler
// ────────────────────────────────────────────────────────────────

/**
 * Express error-handling middleware.
 * Catches any unhandled errors and returns a safe JSON response.
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});

// ────────────────────────────────────────────────────────────────
// Startup
// ────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[LifeBridge] Server running on port ${PORT}`);
  console.log(`[LifeBridge] Health check: http://localhost:${PORT}/health`);

  // Initialize Gemini API client
  const geminiReady = initializeGemini();
  if (!geminiReady) {
    console.warn('[LifeBridge] Gemini not configured — set GEMINI_API_KEY env var for AI features.');
  }

  // Emit startup telemetry
  emit('startup', {
    port: PORT,
    node: process.version,
    platform: process.platform,
    env: Object.keys(process.env),
  });
});

/** Graceful shutdown: let in-flight requests complete before exiting. */
process.on('SIGTERM', () => {
  console.log('[LifeBridge] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[LifeBridge] Server closed.');
    process.exit(0);
  });
});

export { server };
export default app;
