/**
 * @module translation
 * @description Google Cloud Translation integration for LifeBridge.
 *
 * Enables LifeBridge to accept inputs in ANY language and route them
 * through the standard Gemini pipeline. This is core to the "universal
 * bridge" mission — emergencies don't respect language barriers.
 *
 * Uses Google Cloud Translation API v2 (Basic) via REST — no extra SDK.
 * Falls back gracefully to the original text on any error or missing key.
 *
 * Environment variables:
 *   - GOOGLE_CLOUD_API_KEY — dedicated Cloud API key (Translation enabled)
 *   - GOOGLE_API_KEY        — fallback
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface DetectionResult {
  language: string;
  languageName: string;
  confidence: number;
  isEnglish: boolean;
}

export interface TranslationResult {
  translatedText: string;
  sourceLanguage: string;
  sourceLanguageName: string;
  wasTranslated: boolean;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** BCP-47 language codes to human-readable names. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi',
  zh: 'Chinese',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  ar: 'Arabic',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  it: 'Italian',
  nl: 'Dutch',
  sw: 'Swahili',
  tr: 'Turkish',
  vi: 'Vietnamese',
  th: 'Thai',
  id: 'Indonesian',
  ms: 'Malay',
  pl: 'Polish',
  uk: 'Ukrainian',
  fa: 'Persian',
  ur: 'Urdu',
  // Additional Indian languages — 22 scheduled languages + major regional
  kn:  'Kannada',
  ml:  'Malayalam',
  gu:  'Gujarati',
  pa:  'Punjabi',
  or:  'Odia',
  as:  'Assamese',
  kok: 'Konkani',
  mai: 'Maithili',
  doi: 'Dogri',
  ks:  'Kashmiri',
  sd:  'Sindhi',
  mni: 'Manipuri',
  sa:  'Sanskrit',
};

const TRANSLATE_BASE_URL = 'https://translation.googleapis.com/language/translate/v2';

// How many characters to sample for language detection (API limit)
const DETECTION_SAMPLE_LENGTH = 1000;

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function getApiKey(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    undefined
  );
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Get the display-friendly name for a BCP-47 language code.
 *
 * @param code - BCP-47 language code (e.g. 'hi', 'zh-CN')
 * @returns Human-readable name, or the code itself if unknown
 */
export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

/**
 * Detect the language of a text string using Google Cloud Translation API.
 *
 * Returns English (`{ isEnglish: true }`) without calling the API when:
 *   - No API key is configured
 *   - The input text is empty
 *
 * @param text - Raw user input text
 * @returns Language detection result
 */
export async function detectLanguage(text: string): Promise<DetectionResult> {
  const english: DetectionResult = {
    language: 'en',
    languageName: 'English',
    confidence: 1.0,
    isEnglish: true,
  };

  const apiKey = getApiKey();
  if (!apiKey || !text.trim()) {
    return english;
  }

  try {
    const url = `${TRANSLATE_BASE_URL}/detect?key=${encodeURIComponent(apiKey)}`;
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text.slice(0, DETECTION_SAMPLE_LENGTH) }),
    });

    if (!response.ok) {
      return english;
    }

    const data = await response.json() as {
      data: { detections: Array<Array<{ language: string; confidence: number }>> };
    };

    const detection = data?.data?.detections?.[0]?.[0];
    if (!detection?.language) {
      return english;
    }

    const language = detection.language;
    return {
      language,
      languageName: getLanguageName(language),
      confidence: detection.confidence ?? 0,
      isEnglish: language === 'en' || language.startsWith('en-'),
    };
  } catch {
    return english;
  }
}

/**
 * Ensure input is in English, translating if necessary.
 *
 * Returns the original text unchanged when:
 *   - The text is already English
 *   - No API key is configured
 *   - The Translation API call fails for any reason
 *
 * @param text - Raw user input in any language
 * @returns Translation result (wasTranslated = false means original text was kept)
 */
export async function ensureEnglish(text: string): Promise<TranslationResult> {
  const detection = await detectLanguage(text);

  // Already English — no API call needed
  if (detection.isEnglish) {
    return {
      translatedText: text,
      sourceLanguage: 'en',
      sourceLanguageName: 'English',
      wasTranslated: false,
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      translatedText: text,
      sourceLanguage: detection.language,
      sourceLanguageName: detection.languageName,
      wasTranslated: false,
    };
  }

  try {
    const url = `${TRANSLATE_BASE_URL}?key=${encodeURIComponent(apiKey)}`;
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: detection.language,
        target: 'en',
        format: 'text',
      }),
    });

    if (!response.ok) {
      return {
        translatedText: text,
        sourceLanguage: detection.language,
        sourceLanguageName: detection.languageName,
        wasTranslated: false,
      };
    }

    const data = await response.json() as {
      data: { translations: Array<{ translatedText: string }> };
    };

    const translated = data?.data?.translations?.[0]?.translatedText;
    if (!translated) {
      return {
        translatedText: text,
        sourceLanguage: detection.language,
        sourceLanguageName: detection.languageName,
        wasTranslated: false,
      };
    }

    return {
      translatedText: translated,
      sourceLanguage: detection.language,
      sourceLanguageName: detection.languageName,
      wasTranslated: true,
    };
  } catch {
    return {
      translatedText: text,
      sourceLanguage: detection.language,
      sourceLanguageName: detection.languageName,
      wasTranslated: false,
    };
  }
}
