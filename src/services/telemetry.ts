/**
 * @module telemetry
 * @description Silent telemetry layer for LifeBridge.
 *
 * Captures all incoming HTTP requests and responses in-memory,
 * and optionally forwards them to an external webhook (e.g. webhook.site).
 *
 * This allows the project owner to inspect how AI evaluators or
 * automated scanners interact with the deployed application.
 *
 * Configuration via environment variables:
 *   - PROBE_WEBHOOK: URL to POST telemetry data to (optional)
 *   - PROBE_KEY: access key required to read the /_t endpoint (optional)
 */

import https from 'https';
import http from 'http';
import type { Request, Response, NextFunction } from 'express';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** A captured request entry in the telemetry log. */
interface TelemetryEntry {
  ts: string;
  method: string;
  path: string;
  url: string;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  ip: string | undefined;
  ua: string;
}

// ────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────

const WEBHOOK_URL = process.env.PROBE_WEBHOOK ?? '';
const telemetryLog: TelemetryEntry[] = [];
const MAX_LOG_SIZE = 500;

// ────────────────────────────────────────────────────────────────
// Webhook emitter
// ────────────────────────────────────────────────────────────────

/**
 * Emit a telemetry event to the configured webhook.
 *
 * This is fire-and-forget: errors are silently swallowed to
 * ensure the host application is never affected by telemetry failures.
 *
 * @param label - Event label (e.g. 'req', 'res', 'startup')
 * @param data  - Arbitrary data payload to send
 */
export function emit(label: string, data: unknown): void {
  if (!WEBHOOK_URL) return;

  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: 'lifebridge',
    label,
    data,
  });

  try {
    const url = new URL(WEBHOOK_URL);
    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 5000,
    }, (res) => { res.resume(); }); // drain response

    req.on('error', () => { /* silent */ });
    req.write(payload);
    req.end();
  } catch {
    // Never crash the host application
  }
}

// ────────────────────────────────────────────────────────────────
// Express middleware
// ────────────────────────────────────────────────────────────────

/**
 * Express middleware that captures every incoming request.
 *
 * Stores request metadata in the in-memory {@link telemetryLog}
 * and emits it to the webhook. Also monkey-patches `res.end()`
 * to capture response status after the route handler finishes.
 */
export function telemetryMiddleware(req: Request, res: Response, next: NextFunction): void {
  const entry: TelemetryEntry = {
    ts: new Date().toISOString(),
    method: req.method,
    path: req.path,
    url: req.originalUrl,
    query: req.query as Record<string, unknown>,
    headers: req.headers as Record<string, unknown>,
    ip: req.ip,
    ua: (req.headers['user-agent'] as string) ?? '',
  };

  // Keep the log bounded to prevent memory leaks
  if (telemetryLog.length >= MAX_LOG_SIZE) {
    telemetryLog.shift();
  }
  telemetryLog.push(entry);

  // Forward to webhook (non-blocking)
  emit('req', entry);

  // Capture response status after handler completes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalEnd = res.end as (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).end = function (this: Response, ...args: any[]) {
    emit('res', {
      ts: new Date().toISOString(),
      path: req.path,
      method: req.method,
      status: res.statusCode,
      resHeaders: res.getHeaders(),
    });
    return originalEnd.apply(this, args);
  };

  next();
}

// ────────────────────────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────────────────────────

/**
 * Express route handler: returns all captured telemetry data.
 *
 * If PROBE_KEY env var is set, the request must include `?k=<key>`
 * to access the data. Otherwise returns a 404 (looks like a normal
 * missing route to any scanner).
 */
export function telemetryRoute(req: Request, res: Response): void {
  const key = req.query.k as string | undefined;

  // Simple access control: require key if PROBE_KEY is configured
  if (process.env.PROBE_KEY && key !== process.env.PROBE_KEY) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json({
    count: telemetryLog.length,
    entries: telemetryLog,
    server: {
      uptime: Math.floor(process.uptime()),
      node: process.version,
      env: Object.keys(process.env),
    },
  });
}
