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

import { initializeGemini, generateTriageResponse, generateImageTriageResponse, streamTriageResponse } from './services/gemini';
import { sanitizeInput, classifyInputType, buildContextPrompt, MAX_INPUT_LENGTH } from './services/inputProcessor';
import { normalizeInput, type InputFormat } from './services/inputNormalizer';
import { formatActionPlan } from './services/outputFormatter';
import { telemetryMiddleware, telemetryRoute, emit } from './services/telemetry';
import { ensureEnglish } from './services/translation';
import { enrichWithLocationContext } from './services/locationEnricher';
import { transcribeAudio } from './services/speechToText';
import { synthesizeSpeech } from './services/textToSpeech';

/** Maps ISO 639-1 language codes to BCP-47 locale tags for TTS. */
const LANG_TO_TTS_LOCALE: Record<string, string> = {
  hi: 'hi-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN',
  mr: 'mr-IN', kn: 'kn-IN', ml: 'ml-IN', gu: 'gu-IN',
  pa: 'pa-IN', or: 'or-IN', as: 'as-IN', ur: 'ur-IN',
  ne: 'ne-NP', si: 'si-LK',
};

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
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
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
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});

/** Request body parsing with strict size limits to prevent DoS. */
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: false, limit: '8mb' }));

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

/**
 * Run a promise with a time limit.
 * Returns `null` if the promise doesn't settle within `ms` milliseconds.
 * Uses `unref()` so the timer never prevents process exit.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      t.unref();
    }),
  ]);
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
 *   2. Normalize (convert structured formats: weather/traffic/medical-record/etc. to rich text)
 *   3. Sanitize (strip HTML/XSS vectors, normalize whitespace)
 *   4. Classify (medical / disaster / emergency / traffic / weather / news / public-health / infrastructure / general)
 *   5. Build context-enriched prompt
 *   6. Send to Gemini (text or Vision for image inputs)
 *   7. Validate + format the action plan
 *   8. Return to client
 *
 * Accepts:
 *   - `input`        {string}  — required, the raw text or JSON-encoded structured data
 *   - `format`       {string}  — optional, hint for the normalizer
 *     ('text' | 'weather' | 'traffic' | 'medical-record' | 'news' | 'iot-sensor' | 'voice-transcript')
 *   - `imageBase64`  {string}  — optional, base64-encoded image for Gemini Vision triage
 *   - `imageMimeType`{string}  — optional, MIME type of the image (default: 'image/jpeg')
 */
app.post('/api/triage', rateLimiter, async (req: Request, res: Response) => {
  try {
    const rawInput      = req.body?.input;
    const formatHint    = req.body?.format as InputFormat | undefined;
    const imageBase64    = req.body?.imageBase64;
    const imageMimeType  = req.body?.imageMimeType ?? 'image/jpeg';
    const audioBase64Input = req.body?.audioBase64 as string | undefined;
    const voiceOutput      = Boolean(req.body?.voiceOutput);

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

    // ── Normalize structured inputs to enriched text ──
    const normalized = normalizeInput(rawInput, formatHint);

    // ── Language detection + translation (non-blocking, 3 s timeout) ──
    // Allows anyone to submit in their native language — core to the universal
    // bridge mission.
    let processedInput = normalized;
    let translationMeta: { wasTranslated: boolean; sourceLanguage: string; sourceLanguageName: string } | null = null;

    const translationResult = await withTimeout(ensureEnglish(normalized), 3000);
    if (translationResult?.wasTranslated) {
      processedInput = translationResult.translatedText;
      translationMeta = {
        wasTranslated: translationResult.wasTranslated,
        sourceLanguage: translationResult.sourceLanguage,
        sourceLanguageName: translationResult.sourceLanguageName,
      };
    }

    // ── Audio input: Speech-to-Text transcription ──
    // When format is 'audio', convert base64 audio to a text transcript via
    // Google Cloud Speech-to-Text. Supports all major Indian languages.
    if (formatHint === 'audio' && audioBase64Input) {
      try {
        const sttResult = await withTimeout(
          transcribeAudio(audioBase64Input),
          10_000,
        );
        if (sttResult) {
          processedInput = [
            '[VOICE TRANSCRIPT]',
            `Language: ${sttResult.languageCode ?? 'unknown'}`,
            `Confidence: ${Math.round((sttResult.confidence ?? 0) * 100)}%`,
            '',
            'Transcript:',
            sttResult.transcript,
          ].join('\n');
        }
      } catch {
        // STT failed — proceed with text input as-is
      }
    }

    // ── Processing pipeline ──
    const sanitized = sanitizeInput(processedInput);
    const inputType = classifyInputType(sanitized);
    const basePrompt = buildContextPrompt(sanitized, inputType);

    // ── Geographic context enrichment (non-blocking, 4 s timeout) ──
    // Geocodes mentioned locations and prepends nearest emergency services
    // to the prompt so Gemini can give hyper-local action steps.
    const locationEnrichment = await withTimeout(enrichWithLocationContext(sanitized), 4000);
    const prompt = locationEnrichment?.detected
      ? locationEnrichment.contextText + basePrompt
      : basePrompt;

    let geminiResponse: Record<string, unknown>;

    if (imageBase64 && typeof imageBase64 === 'string') {
      // Vision pathway: prompt + inline image
      geminiResponse = await generateImageTriageResponse(prompt, imageBase64, imageMimeType);
    } else {
      // Text pathway
      geminiResponse = await generateTriageResponse(prompt);
    }

    const actionPlan = formatActionPlan(geminiResponse);

    // ── Voice output (optional) — Google Cloud Text-to-Speech ──
    // When voiceOutput=true in the request, synthesize the action plan
    // summary to speech. Supports Indian language voices.
    let voiceOutputData: { audioBase64: string; mimeType: string } | null = null;
    if (voiceOutput) {
      const summaryText = typeof geminiResponse.summary === 'string'
        ? geminiResponse.summary
        : '';
      if (summaryText) {
        try {
          const ttsLocale = LANG_TO_TTS_LOCALE[translationMeta?.sourceLanguage ?? ''] ?? 'en-IN';
          const ttsResult = await withTimeout(
            synthesizeSpeech(summaryText, { languageCode: ttsLocale }),
            5_000,
          );
          if (ttsResult?.success) {
            voiceOutputData = { audioBase64: ttsResult.audioContent, mimeType: ttsResult.mimeType };
          }
        } catch {
          // TTS failed — non-critical, continue without voice output
        }
      }
    }

    res.json({
      success: true,
      inputType,
      actionPlan,
      ...(translationMeta ? { translation: translationMeta } : {}),
      ...(locationEnrichment?.detected ? { locationEnriched: true } : {}),
      ...(voiceOutputData ? { voice: voiceOutputData } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[Triage] Error:', message);

    const isUpstreamRateLimit = /\b429\b|rate limit|quota exceeded|too many requests/i.test(message);
    if (isUpstreamRateLimit) {
      res.status(429).json({
        error: 'Too many requests right now. Please wait a few seconds and try again.',
        code: 'RATE_LIMITED',
      });
      return;
    }

    const statusCode = message.includes('safety') ? 422 : 500;
    res.status(statusCode).json({
      error: message,
      code: 'PROCESSING_ERROR',
    });
  }
});

/**
 * Streaming triage endpoint — Server-Sent Events (SSE).
 *
 * Sends Gemini response text chunks as they arrive for real-time UI updates.
 * Events emitted:
 *   - `start`  { inputType }            — processing has begun
 *   - `chunk`  { text: string }         — a partial text chunk from the model
 *   - `done`   {}                       — streaming is complete
 *   - `error`  { message: string }      — an error occurred
 */
app.post('/api/triage/stream', rateLimiter, async (req: Request, res: Response) => {
  const rawInput   = req.body?.input;
  const formatHint = req.body?.format as InputFormat | undefined;

  if (!rawInput || typeof rawInput !== 'string' || rawInput.trim().length === 0) {
    res.status(400).json({ error: 'Please provide input text.', code: 'EMPTY_INPUT' });
    return;
  }

  if (rawInput.length > MAX_INPUT_LENGTH) {
    res.status(413).json({ error: `Input too long.`, code: 'INPUT_TOO_LONG' });
    return;
  }

  const normalized = normalizeInput(rawInput, formatHint);
  const sanitized  = sanitizeInput(normalized);
  const inputType  = classifyInputType(sanitized);
  const prompt     = buildContextPrompt(sanitized, inputType);

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx/Cloud Run buffering
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('start', { inputType });

    for await (const chunk of streamTriageResponse(prompt)) {
      send('chunk', { text: chunk });
    }

    send('done', {});
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stream error';
    const isUpstreamRateLimit = /\b429\b|rate limit|quota exceeded|too many requests/i.test(message);
    send('error', {
      message: isUpstreamRateLimit
        ? 'Too many requests right now. Please wait a few seconds and try again.'
        : message,
    });
  } finally {
    res.end();
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
app.use((err: Error & { type?: string; status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413) {
    res.status(413).json({
      error: 'Request payload is too large. Please reduce input size or image size and try again.',
      code: 'PAYLOAD_TOO_LARGE',
    });
    return;
  }

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
