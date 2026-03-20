/**
 * @module server.test
 * @description Integration tests for the LifeBridge Express server.
 *
 * Tests the HTTP API layer:
 *   - Health endpoint behavior
 *   - Input validation (empty, oversized)
 *   - Static file serving
 *   - 404 handling for unknown routes
 *   - Security headers
 *   - Robots.txt
 *
 * Note: These tests do NOT call the Gemini API. They validate
 * the server's validation, routing, and middleware layers.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

// ────────────────────────────────────────────────────────────────
// Test server setup
// ────────────────────────────────────────────────────────────────

const PORT = 9876;
process.env.PORT = String(PORT);

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Make an HTTP request to the test server.
 * Returns a promise with the status code, headers, and body.
 */
function request(options: {
  method?: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      method: options.method ?? 'GET',
      path: options.path,
      headers: {
        ...options.headers,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/** Wait for the server to be ready by polling the health endpoint. */
function waitForServer(maxRetries = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://localhost:${PORT}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', () => retry());
    };
    const retry = () => {
      attempts++;
      if (attempts >= maxRetries) {
        reject(new Error('Server did not start in time'));
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

// ────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────

describe('LifeBridge Server Integration Tests', () => {
  before(async () => {
    // Import server (triggers app.listen on PORT)
    require('../server');
    // Wait for it to be ready
    await waitForServer();
  });

  describe('GET /health', () => {
    it('should return 200 with healthy status', async () => {
      const res = await request({ path: '/health' });
      assert.equal(res.statusCode, 200);

      const data = JSON.parse(res.body);
      assert.equal(data.status, 'healthy');
      assert.equal(data.service, 'lifebridge');
      assert.ok(typeof data.uptime === 'number');
      assert.ok(data.timestamp);
    });
  });

  describe('GET /', () => {
    it('should return 200 with HTML content', async () => {
      const res = await request({ path: '/' });
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type']?.includes('text/html'));
      assert.ok(res.body.includes('LifeBridge'));
    });
  });

  describe('POST /api/triage — validation', () => {
    it('should return 400 for empty body', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({}),
      });
      assert.equal(res.statusCode, 400);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'EMPTY_INPUT');
    });

    it('should return 400 for missing input field', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({ message: 'wrong field name' }),
      });
      assert.equal(res.statusCode, 400);
    });

    it('should return 400 for whitespace-only input', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({ input: '   ' }),
      });
      assert.equal(res.statusCode, 400);
    });

    it('should return 413 for oversized input', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({ input: 'x'.repeat(6000) }),
      });
      assert.equal(res.statusCode, 413);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'INPUT_TOO_LONG');
    });
  });

  describe('Security headers', () => {
    it('should include X-Content-Type-Options header', async () => {
      const res = await request({ path: '/health' });
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
    });

    it('should include X-Frame-Options header', async () => {
      const res = await request({ path: '/health' });
      assert.equal(res.headers['x-frame-options'], 'DENY');
    });

    it('should include Referrer-Policy header', async () => {
      const res = await request({ path: '/health' });
      assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    });
  });

  describe('GET /robots.txt', () => {
    it('should return robots.txt with Allow all', async () => {
      const res = await request({ path: '/robots.txt' });
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes('User-agent: *'));
      assert.ok(res.body.includes('Allow: /'));
    });
  });

  describe('404 handling', () => {
    it('should return 404 JSON for unknown routes', async () => {
      const res = await request({ path: '/nonexistent-route' });
      assert.equal(res.statusCode, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.error, 'Not found');
      assert.equal(data.path, '/nonexistent-route');
    });
  });

  describe('GET /favicon.ico', () => {
    it('should return 204 No Content', async () => {
      const res = await request({ path: '/favicon.ico' });
      assert.equal(res.statusCode, 204);
    });
  });
});
