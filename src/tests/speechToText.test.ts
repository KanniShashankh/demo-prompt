/**
 * @module speechToText.test
 * @description Unit tests for the Google Cloud Speech-to-Text service.
 *
 * HTTP calls are replaced with a mocked global.fetch so the suite runs
 * fully offline without any real credentials.
 *
 * Coverage:
 *   - INDIAN_LANGUAGE_CODES exports all major languages
 *   - isSupportedIndianLanguage: known codes, unknown codes, edge cases
 *   - transcribeAudio:
 *       - no API key fallback
 *       - empty / whitespace audio fallback
 *       - happy path (single segment)
 *       - multi-segment concatenation
 *       - missing confidence defaults to 0
 *       - empty results array fallback
 *       - missing results key fallback
 *       - empty alternatives array fallback
 *       - empty transcript string fallback
 *       - HTTP error response fallback
 *       - network (throw) error fallback
 *       - GOOGLE_API_KEY used as fallback key
 *       - languageCode from config is sent in request body
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  transcribeAudio,
  isSupportedIndianLanguage,
  INDIAN_LANGUAGE_CODES,
} from '../services/speechToText';

// ────────────────────────────────────────────────────────────────
// Mock helpers
// ────────────────────────────────────────────────────────────────

function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

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
// INDIAN_LANGUAGE_CODES
// ────────────────────────────────────────────────────────────────

describe('INDIAN_LANGUAGE_CODES — completeness', () => {
  it('should include en-IN (English India)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('en-IN'));
  });

  it('should include hi-IN (Hindi)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('hi-IN'));
  });

  it('should include ta-IN (Tamil)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('ta-IN'));
  });

  it('should include te-IN (Telugu)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('te-IN'));
  });

  it('should include bn-IN (Bengali)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('bn-IN'));
  });

  it('should include kn-IN (Kannada)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('kn-IN'));
  });

  it('should include ml-IN (Malayalam)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('ml-IN'));
  });

  it('should include gu-IN (Gujarati)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('gu-IN'));
  });

  it('should include pa-IN (Punjabi)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('pa-IN'));
  });

  it('should include mr-IN (Marathi)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('mr-IN'));
  });

  it('should include or-IN (Odia)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('or-IN'));
  });

  it('should include as-IN (Assamese)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('as-IN'));
  });

  it('should include ur-IN (Urdu)', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.includes('ur-IN'));
  });

  it('should have at least 10 language codes', () => {
    assert.ok(INDIAN_LANGUAGE_CODES.length >= 10);
  });
});

// ────────────────────────────────────────────────────────────────
// isSupportedIndianLanguage
// ────────────────────────────────────────────────────────────────

describe('isSupportedIndianLanguage', () => {
  it('should return true for hi-IN', () => {
    assert.equal(isSupportedIndianLanguage('hi-IN'), true);
  });

  it('should return true for ta-IN', () => {
    assert.equal(isSupportedIndianLanguage('ta-IN'), true);
  });

  it('should return true for en-IN', () => {
    assert.equal(isSupportedIndianLanguage('en-IN'), true);
  });

  it('should return true for ml-IN', () => {
    assert.equal(isSupportedIndianLanguage('ml-IN'), true);
  });

  it('should return false for en-US', () => {
    assert.equal(isSupportedIndianLanguage('en-US'), false);
  });

  it('should return false for fr-FR', () => {
    assert.equal(isSupportedIndianLanguage('fr-FR'), false);
  });

  it('should return false for an unknown code', () => {
    assert.equal(isSupportedIndianLanguage('xx-XX'), false);
  });

  it('should return false for empty string', () => {
    assert.equal(isSupportedIndianLanguage(''), false);
  });
});

// ────────────────────────────────────────────────────────────────
// transcribeAudio — no API key
// ────────────────────────────────────────────────────────────────

describe('transcribeAudio — no API key', () => {
  it('should return success=false when neither key env var is set', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
    assert.equal(result.transcript, '');
    assert.equal(result.confidence, 0);
  });
});

// ────────────────────────────────────────────────────────────────
// transcribeAudio — empty / whitespace audio
// ────────────────────────────────────────────────────────────────

describe('transcribeAudio — empty audio', () => {
  it('should return success=false for empty string', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    const result = await transcribeAudio('');
    assert.equal(result.success, false);
    assert.equal(result.transcript, '');
  });

  it('should return success=false for whitespace-only audio string', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    const result = await transcribeAudio('   ');
    assert.equal(result.success, false);
  });
});

// ────────────────────────────────────────────────────────────────
// transcribeAudio — happy path
// ────────────────────────────────────────────────────────────────

describe('transcribeAudio — successful transcription', () => {
  it('should return the transcript on a successful single-segment response', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({
      results: [
        {
          alternatives: [{ transcript: 'Mujhe madad chahiye', confidence: 0.97 }],
          languageCode: 'hi-in',
        },
      ],
    });

    const result = await transcribeAudio('dGVzdA==', { languageCode: 'hi-IN' });
    assert.equal(result.success, true);
    assert.equal(result.transcript, 'Mujhe madad chahiye');
    assert.equal(result.confidence, 0.97);
    assert.equal(result.languageCode, 'hi-in');
  });

  it('should concatenate multiple result segments into one transcript', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({
      results: [
        { alternatives: [{ transcript: 'First portion', confidence: 0.9 }] },
        { alternatives: [{ transcript: 'second portion', confidence: 0.88 }] },
      ],
    });

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, true);
    assert.equal(result.transcript, 'First portion second portion');
  });

  it('should default confidence to 0 when not provided by API', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({
      results: [{ alternatives: [{ transcript: 'Help me' }] }],
    });

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, true);
    assert.equal(result.confidence, 0);
  });

  it('should use config languageCode as default when API omits it', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({
      results: [{ alternatives: [{ transcript: 'Test' }] }],
      // no languageCode in result
    });

    const result = await transcribeAudio('dGVzdA==', { languageCode: 'ta-IN' });
    assert.equal(result.languageCode, 'ta-IN');
  });
});

// ────────────────────────────────────────────────────────────────
// transcribeAudio — empty / missing results
// ────────────────────────────────────────────────────────────────

describe('transcribeAudio — empty/missing result fallbacks', () => {
  it('should return success=false when results array is empty', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ results: [] });

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
    assert.equal(result.transcript, '');
  });

  it('should return success=false when results key is absent', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({});

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
  });

  it('should return success=false when alternatives array is empty', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({
      results: [{ alternatives: [] }],
    });

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
  });

  it('should return success=false when transcript is an empty string', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({
      results: [{ alternatives: [{ transcript: '' }] }],
    });

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
  });
});

// ────────────────────────────────────────────────────────────────
// transcribeAudio — HTTP and network errors
// ────────────────────────────────────────────────────────────────

describe('transcribeAudio — error handling', () => {
  it('should return success=false on non-OK HTTP response', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ error: { message: 'PERMISSION_DENIED' } }, false);

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
  });

  it('should return success=false on network error (fetch throw)', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => { throw new Error('Network unreachable'); };

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, false);
    assert.equal(result.transcript, '');
  });
});

// ────────────────────────────────────────────────────────────────
// transcribeAudio — API key selection and request contents
// ────────────────────────────────────────────────────────────────

describe('transcribeAudio — key selection and request', () => {
  it('should use GOOGLE_API_KEY as fallback when GOOGLE_CLOUD_API_KEY is absent', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    process.env.GOOGLE_API_KEY = 'fallback-key';

    let capturedUrl = '';
    globalThis.fetch = async (url) => {
      capturedUrl = String(url);
      return mockJsonResponse({
        results: [{ alternatives: [{ transcript: 'Fallback works' }] }],
      });
    };

    const result = await transcribeAudio('dGVzdA==');
    assert.equal(result.success, true);
    assert.ok(capturedUrl.includes('fallback-key'));
  });

  it('should include languageCode in the request body', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({
        results: [{ alternatives: [{ transcript: 'Ok' }] }],
      });
    };

    await transcribeAudio('dGVzdA==', { languageCode: 'ta-IN' });
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.config.languageCode, 'ta-IN');
  });

  it('should include the audio content in the request body', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({
        results: [{ alternatives: [{ transcript: 'Ok' }] }],
      });
    };

    await transcribeAudio('myBase64Audio==');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.audio.content, 'myBase64Audio==');
  });

  it('should send enableAutomaticPunctuation as true by default', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let capturedBody = '';
    globalThis.fetch = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return mockJsonResponse({
        results: [{ alternatives: [{ transcript: 'Ok' }] }],
      });
    };

    await transcribeAudio('dGVzdA==');
    const parsed = JSON.parse(capturedBody);
    assert.equal(parsed.config.enableAutomaticPunctuation, true);
  });
});
