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

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'http';

const PORT = 9876;
process.env.PORT = String(PORT);
let testServer: Server | null = null;

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

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

describe('LifeBridge Server Integration Tests', () => {
  before(async () => {
    const serverModule = require('../server') as { server?: Server };
    testServer = serverModule.server ?? null;
    await waitForServer();
  });

  after(async () => {
    if (!testServer) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      testServer?.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    testServer = null;
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

    it('should include X-XSS-Protection header', async () => {
      const res = await request({ path: '/health' });
      assert.equal(res.headers['x-xss-protection'], '1; mode=block');
    });

    it('should include Permissions-Policy header restricting camera and allowing same-origin microphone', async () => {
      const res = await request({ path: '/health' });
      const policy = res.headers['permissions-policy'] ?? '';
      assert.ok(policy.includes('camera=()'), 'Permissions-Policy should restrict camera');
      assert.ok(policy.includes('microphone=(self)'), 'Permissions-Policy should allow microphone for same-origin use');
    });
  });

  describe('POST /api/triage — format field', () => {
    it('should not reject requests that include a valid format hint', async () => {
      // The schema allows an optional "format" field; it should not cause a 400/413
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({
          input: 'temperature 41 degrees extreme heat wave warning',
          format: 'weather',
        }),
      });
      // 400/413 would mean our validation wrongly rejected the format field
      assert.notEqual(res.statusCode, 400, 'format field should not cause 400');
      assert.notEqual(res.statusCode, 413, 'format field should not cause 413');
    });

    it('should not reject requests that include a voice-transcript format hint', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({
          input: 'Person collapsed, not breathing, need help',
          format: 'voice-transcript',
        }),
      });
      assert.notEqual(res.statusCode, 400, 'voice-transcript format should not cause 400');
      assert.notEqual(res.statusCode, 413, 'voice-transcript format should not cause 413');
    });

    it('should not reject requests that include an iot-sensor format hint', async () => {
      const res = await request({
        method: 'POST',
        path: '/api/triage',
        body: JSON.stringify({
          input: 'CO2 levels at 2000ppm, smoke detected, building evacuation needed',
          format: 'iot-sensor',
        }),
      });
      assert.notEqual(res.statusCode, 400);
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
