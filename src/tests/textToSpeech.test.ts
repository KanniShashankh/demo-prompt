/**
 * @module textToSpeech.test
 * @description Unit tests for the Google Cloud Text-to-Speech service.
 *
 * HTTP calls are replaced with a mocked global.fetch so the suite runs
 * fully offline without any real credentials.
 *
 * Coverage:
 *   - buildSpokenSummary: full plan, partial plan, step truncation,
 *                         first warning only, missing fields, empty plan
 *   - synthesizeSpeech:
 *       - no API key fallback
 *       - empty / whitespace text fallback
 *       - happy path (MP3 response)
 *       - OGG_OPUS MIME type mapping
 *       - LINEAR16 MIME type mapping
 *       - MULAW MIME type mapping
 *       - Indian language voice in request body
 *       - GOOGLE_API_KEY fallback key
 *       - text truncation at 5000 chars
 *       - short text not truncated
 *       - HTTP error response fallback
 *       - network (throw) error fallback
 *       - missing audioContent fallback
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  synthesizeSpeech,
  buildSpokenSummary,
} from '../services/textToSpeech';

// ────────────────────────────────────────────────────────────────
// Mock helpers
// ────────────────────────────────────────────────────────────────

function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

const FAKE_AUDIO = 'SUQzBAAAAAAA'; // plausible base64 placeholder

let savedFetch: typeof globalThis.fetch;
let savedCloudKey: string | undefined;
let savedApiKey: string | undefined;

beforeEach(() => {
  savedFetch    = globalThis.fetch;
  savedCloudKey = process.env.GOOGLE_CLOUD_API_KEY;
  savedApiKey   = process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedCloudKey === undefined) {
    delete process.env.GOOGLE_CLOUD_API_KEY;
  } else {
    process.env.GOOGLE_CLOUD_API_KEY = savedCloudKey;
  }
  if (savedApiKey === undefined) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = savedApiKey;
  }
});

// ────────────────────────────────────────────────────────────────
// buildSpokenSummary
// ────────────────────────────────────────────────────────────────

describe('buildSpokenSummary — full plan', () => {
  it('should include severity level in the output', () => {
    const plan = { severity: 'CRITICAL', summary: 'Cardiac arrest detected.' };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('CRITICAL'));
  });

  it('should include the summary sentence', () => {
    const plan = { severity: 'URGENT', summary: 'Flood is approaching rapidly.' };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('Flood is approaching rapidly.'));
  });

  it('should include the first 3 action steps only', () => {
    const plan = {
      severity: 'MODERATE',
      summary: 'Test incident.',
      actionSteps: [
        { action: 'Step A' },
        { action: 'Step B' },
        { action: 'Step C' },
        { action: 'Step D — must be excluded' },
      ],
    };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('Step A'));
    assert.ok(result.includes('Step B'));
    assert.ok(result.includes('Step C'));
    assert.ok(!result.includes('Step D'));
  });

  it('should include step numbers', () => {
    const plan = {
      severity: 'LOW',
      summary: 'Minor incident.',
      actionSteps: [
        { action: 'Apply pressure to the wound' },
      ],
    };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('Step 1:'));
    assert.ok(result.includes('Apply pressure'));
  });

  it('should include only the first warning', () => {
    const plan = {
      severity: 'LOW',
      summary: 'Minor incident.',
      warnings: ['Watch for gas leaks.', 'Second warning — must not appear'],
    };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('Watch for gas leaks.'));
    assert.ok(!result.includes('Second warning'));
  });

  it('should include "Warning:" prefix before the warning', () => {
    const plan = {
      severity: 'URGENT',
      summary: 'Fire spreading.',
      warnings: ['Do not enter the building.'],
    };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('Warning: Do not enter the building.'));
  });
});

describe('buildSpokenSummary — partial / missing fields', () => {
  it('should handle a plan with only severity', () => {
    const result = buildSpokenSummary({ severity: 'URGENT' });
    assert.ok(result.includes('URGENT'));
  });

  it('should handle a plan with only summary', () => {
    const result = buildSpokenSummary({ summary: 'Person is unconscious.' });
    assert.ok(result.includes('Person is unconscious.'));
  });

  it('should return a string for an empty plan without throwing', () => {
    const result = buildSpokenSummary({});
    assert.equal(typeof result, 'string');
  });

  it('should skip action steps with missing action fields', () => {
    const plan = {
      severity: 'MODERATE',
      summary: 'Test.',
      actionSteps: [
        { priority: 1 },            // no action field
        { action: 'Valid action' },
      ],
    };
    const result = buildSpokenSummary(plan);
    assert.ok(result.includes('Valid action'));
  });

  it('should handle non-string severity gracefully', () => {
    const plan = { severity: 42, summary: 'Test.' };
    const result = buildSpokenSummary(plan as Record<string, unknown>);
    assert.ok(!result.includes('42'));
    assert.ok(result.includes('Test.'));
  });
});

// ────────────────────────────────────────────────────────────────
// synthesizeSpeech — no API key
// ────────────────────────────────────────────────────────────────

describe('synthesizeSpeech — no API key', () => {
  it('should return success=false when no key env var is set', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const result = await synthesizeSpeech('Call 108 immediately.');
    assert.equal(result.success, false);
    assert.equal(result.audioContent, '');
  });

  it('should return a valid mimeType even on failure', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const result = await synthesizeSpeech('Test.', { audioEncoding: 'OGG_OPUS' });
    assert.equal(result.mimeType, 'audio/ogg');
    assert.equal(result.success, false);
  });
});

// ────────────────────────────────────────────────────────────────
// synthesizeSpeech — empty text
// ────────────────────────────────────────────────────────────────

describe('synthesizeSpeech — empty text', () => {
  it('should return success=false for empty string', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    const result = await synthesizeSpeech('');
    assert.equal(result.success, false);
    assert.equal(result.audioContent, '');
  });

  it('should return success=false for whitespace-only text', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    const result = await synthesizeSpeech('   ');
    assert.equal(result.success, false);
  });
});

// ────────────────────────────────────────────────────────────────
// synthesizeSpeech — happy path
// ────────────────────────────────────────────────────────────────

describe('synthesizeSpeech — successful synthesis', () => {
  it('should return base64 audioContent and success=true on happy path', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ audioContent: FAKE_AUDIO });

    const result = await synthesizeSpeech('Call emergency services now.');
    assert.equal(result.success, true);
    assert.equal(result.audioContent, FAKE_AUDIO);
    assert.equal(result.mimeType, 'audio/mpeg');
  });

  it('should return audio/ogg MIME when encoding is OGG_OPUS', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ audioContent: FAKE_AUDIO });

    const result = await synthesizeSpeech('Test.', { audioEncoding: 'OGG_OPUS' });
    assert.equal(result.success, true);
    assert.equal(result.mimeType, 'audio/ogg');
  });

  it('should return audio/wav MIME when encoding is LINEAR16', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ audioContent: FAKE_AUDIO });

    const result = await synthesizeSpeech('Test.', { audioEncoding: 'LINEAR16' });
    assert.equal(result.mimeType, 'audio/wav');
  });

  it('should return audio/basic MIME when encoding is MULAW', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ audioContent: FAKE_AUDIO });

    const result = await synthesizeSpeech('Test.', { audioEncoding: 'MULAW' });
    assert.equal(result.mimeType, 'audio/basic');
  });

  it('should include Indian language code in request voice configuration', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({ audioContent: FAKE_AUDIO });
    };

    await synthesizeSpeech('Turant sahayata ke liye kripya sampark karen.', { languageCode: 'hi-IN' });
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.voice.languageCode, 'hi-IN');
  });

  it('should use GOOGLE_API_KEY as fallback', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    process.env.GOOGLE_API_KEY = 'fallback-key';

    let capturedUrl = '';
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return mockJsonResponse({ audioContent: FAKE_AUDIO });
    };

    const result = await synthesizeSpeech('Test speech.');
    assert.equal(result.success, true);
    assert.ok(capturedUrl.includes('fallback-key'));
  });

  it('should default to en-IN voice when no languageCode is provided', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({ audioContent: FAKE_AUDIO });
    };

    await synthesizeSpeech('Test.');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.voice.languageCode, 'en-IN');
  });

  it('should use speaking rate 0.9 by default', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({ audioContent: FAKE_AUDIO });
    };

    await synthesizeSpeech('Test.');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.audioConfig.speakingRate, 0.9);
  });
});

// ────────────────────────────────────────────────────────────────
// synthesizeSpeech — text truncation
// ────────────────────────────────────────────────────────────────

describe('synthesizeSpeech — text truncation', () => {
  it('should truncate text longer than 5000 characters and append "..."', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({ audioContent: FAKE_AUDIO });
    };

    const longText = 'a'.repeat(6000);
    await synthesizeSpeech(longText);

    const parsed = JSON.parse(capturedBody);
    // 5000 chars + '...' = 5003
    assert.ok(parsed.input.text.length <= 5003);
    assert.ok(parsed.input.text.endsWith('...'));
  });

  it('should not truncate text under 5000 characters', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({ audioContent: FAKE_AUDIO });
    };

    const shortText = 'Call 108 immediately.';
    await synthesizeSpeech(shortText);

    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.input.text, shortText);
  });
});

// ────────────────────────────────────────────────────────────────
// synthesizeSpeech — error handling
// ────────────────────────────────────────────────────────────────

describe('synthesizeSpeech — error handling', () => {
  it('should return success=false on non-OK HTTP response', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ error: { message: 'QUOTA_EXCEEDED' } }, false);

    const result = await synthesizeSpeech('Test.');
    assert.equal(result.success, false);
    assert.equal(result.audioContent, '');
  });

  it('should return success=false on network error (fetch throw)', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => { throw new Error('Network failure'); };

    const result = await synthesizeSpeech('Test.');
    assert.equal(result.success, false);
    assert.equal(result.audioContent, '');
  });

  it('should return success=false when API response omits audioContent', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({});

    const result = await synthesizeSpeech('Test.');
    assert.equal(result.success, false);
    assert.equal(result.audioContent, '');
  });
});
