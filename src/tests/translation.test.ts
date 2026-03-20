/**
 * @module translation.test
 * @description Unit tests for the translation service.
 *
 * HTTP-calling functions are tested with a mocked global.fetch so they
 * run offline and deterministically in CI/CD and local environments.
 *
 * Coverage:
 *   - getLanguageName: known / unknown codes
 *   - detectLanguage: no-key fallback, English pass-through, API response parsing,
 *                     HTTP error fallback, network error fallback
 *   - ensureEnglish: English pass-through, successful translation,
 *                    no-key fallback, API error fallback, empty translation fallback
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getLanguageName,
  detectLanguage,
  ensureEnglish,
} from '../services/translation';

// ────────────────────────────────────────────────────────────────
// Mock helpers
// ────────────────────────────────────────────────────────────────

/** Build a mock Response-like object that resolves to the given JSON. */
function mockJsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Response;
}

/** Save / restore global.fetch around each test. */
let savedFetch: typeof globalThis.fetch;
let savedApiKey: string | undefined;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedApiKey = process.env.GOOGLE_CLOUD_API_KEY;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedApiKey === undefined) {
    delete process.env.GOOGLE_CLOUD_API_KEY;
  } else {
    process.env.GOOGLE_CLOUD_API_KEY = savedApiKey;
  }
});

// ────────────────────────────────────────────────────────────────
// getLanguageName
// ────────────────────────────────────────────────────────────────

describe('getLanguageName', () => {
  it('should return "English" for code "en"', () => {
    assert.equal(getLanguageName('en'), 'English');
  });

  it('should return "Hindi" for code "hi"', () => {
    assert.equal(getLanguageName('hi'), 'Hindi');
  });

  it('should return "Spanish" for code "es"', () => {
    assert.equal(getLanguageName('es'), 'Spanish');
  });

  it('should return "Chinese (Simplified)" for code "zh-CN"', () => {
    assert.equal(getLanguageName('zh-CN'), 'Chinese (Simplified)');
  });

  it('should return the code in uppercase for unknown codes', () => {
    assert.equal(getLanguageName('xx'), 'XX');
  });

  it('should return "Swahili" for code "sw"', () => {
    assert.equal(getLanguageName('sw'), 'Swahili');
  });
});

// ────────────────────────────────────────────────────────────────
// detectLanguage
// ────────────────────────────────────────────────────────────────

describe('detectLanguage', () => {
  it('should return English without calling API when no API key is set', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return mockJsonResponse({});
    };

    const result = await detectLanguage('Hola mundo');
    assert.equal(result.isEnglish, true);
    assert.equal(result.language, 'en');
    assert.equal(fetchCalled, false, 'fetch should not be called without an API key');
  });

  it('should return English without calling API when text is empty', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return mockJsonResponse({});
    };

    const result = await detectLanguage('');
    assert.equal(result.isEnglish, true);
    assert.equal(fetchCalled, false);
  });

  it('should return detected language from successful API response', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    globalThis.fetch = async () => mockJsonResponse({
      data: {
        detections: [[{ language: 'hi', confidence: 0.98 }]],
      },
    });

    const result = await detectLanguage('मेरे पिता को दिल का दौरा पड़ रहा है');
    assert.equal(result.language, 'hi');
    assert.equal(result.languageName, 'Hindi');
    assert.equal(result.isEnglish, false);
    assert.equal(result.confidence, 0.98);
  });

  it('should mark English detection as isEnglish = true', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';

    globalThis.fetch = async () => mockJsonResponse({
      data: {
        detections: [[{ language: 'en', confidence: 1.0 }]],
      },
    });

    const result = await detectLanguage('Patient has chest pain');
    assert.equal(result.isEnglish, true);
    assert.equal(result.language, 'en');
  });

  it('should fall back to English on HTTP error response', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({}, false /* ok=false */);

    const result = await detectLanguage('Hola');
    assert.equal(result.isEnglish, true);
    assert.equal(result.language, 'en');
  });

  it('should fall back to English on network error (fetch throws)', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => { throw new Error('Network error'); };

    const result = await detectLanguage('Hola');
    assert.equal(result.isEnglish, true);
    assert.equal(result.language, 'en');
  });

  it('should fall back to English when API response has unexpected shape', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ unexpected: 'shape' });

    const result = await detectLanguage('Hola');
    assert.equal(result.isEnglish, true);
  });
});

// ────────────────────────────────────────────────────────────────
// ensureEnglish
// ────────────────────────────────────────────────────────────────

describe('ensureEnglish', () => {
  it('should return text unchanged when already English (no API call)', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let fetchCallCount = 0;

    // detectLanguage returns English → ensureEnglish should skip translation call
    globalThis.fetch = async () => {
      fetchCallCount++;
      return mockJsonResponse({
        data: { detections: [[{ language: 'en', confidence: 0.99 }]] },
      });
    };

    const result = await ensureEnglish('Patient collapsed at home');
    assert.equal(result.wasTranslated, false);
    assert.equal(result.translatedText, 'Patient collapsed at home');
    assert.equal(result.sourceLanguage, 'en');
    // Only one call (detect), no translate call
    assert.equal(fetchCallCount, 1);
  });

  it('should translate non-English text to English', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let callIndex = 0;

    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        // detectLanguage call
        return mockJsonResponse({
          data: { detections: [[{ language: 'es', confidence: 0.97 }]] },
        });
      }
      // translate call
      return mockJsonResponse({
        data: { translations: [{ translatedText: 'My father is having a heart attack' }] },
      });
    };

    const result = await ensureEnglish('Mi padre está teniendo un ataque al corazón');
    assert.equal(result.wasTranslated, true);
    assert.equal(result.translatedText, 'My father is having a heart attack');
    assert.equal(result.sourceLanguage, 'es');
    assert.equal(result.sourceLanguageName, 'Spanish');
  });

  it('should return original text when no API key is set', async () => {
    delete process.env.GOOGLE_CLOUD_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const input = 'मदद की ज़रूरत है';
    const result = await ensureEnglish(input);
    assert.equal(result.wasTranslated, false);
    assert.equal(result.translatedText, input);
  });

  it('should fall back to original text when translation API returns HTTP error', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let callIndex = 0;

    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        return mockJsonResponse({
          data: { detections: [[{ language: 'fr', confidence: 0.95 }]] },
        });
      }
      return mockJsonResponse({}, false /* ok=false */);
    };

    const input = 'Au secours, il y a un incendie';
    const result = await ensureEnglish(input);
    assert.equal(result.wasTranslated, false);
    assert.equal(result.translatedText, input);
    assert.equal(result.sourceLanguage, 'fr');
  });

  it('should fall back to original text when translation response has empty translations', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let callIndex = 0;

    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        return mockJsonResponse({
          data: { detections: [[{ language: 'de', confidence: 0.92 }]] },
        });
      }
      return mockJsonResponse({ data: { translations: [] } });
    };

    const input = 'Hilfe, es gibt einen Unfall';
    const result = await ensureEnglish(input);
    assert.equal(result.wasTranslated, false);
    assert.equal(result.translatedText, input);
  });

  it('should fall back to original text when network throws during translation', async () => {
    process.env.GOOGLE_CLOUD_API_KEY = 'test-key';
    let callIndex = 0;

    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        return mockJsonResponse({
          data: { detections: [[{ language: 'ja', confidence: 0.9 }]] },
        });
      }
      throw new Error('Network timeout');
    };

    const input = '助けてください';
    const result = await ensureEnglish(input);
    assert.equal(result.wasTranslated, false);
    assert.equal(result.translatedText, input);
    assert.equal(result.sourceLanguage, 'ja');
    assert.equal(result.sourceLanguageName, 'Japanese');
  });
});
