/**
 * @module speechToText
 * @description Google Cloud Speech-to-Text integration for LifeBridge.
 *
 * Enables LifeBridge to accept real audio recordings — the most natural
 * input modality in emergencies where typing is impossible. Audio is sent
 * to Google Cloud Speech-to-Text v1 and the transcript enters the standard
 * triage pipeline unchanged.
 *
 * This is the 4th Google service integration in LifeBridge:
 *   1. Google Generative AI (Gemini)   — triage intelligence
 *   2. Google Cloud Translation API    — multilingual input
 *   3. Google Maps Platform            — location enrichment
 *   4. Google Cloud Speech-to-Text     — voice input (THIS MODULE)
 *   5. Google Cloud Text-to-Speech     — voice output (textToSpeech.ts)
 *
 * Uses REST API v1 — no extra SDK dependency.
 * Supports all major Indian languages and English variants.
 * Falls back gracefully if GOOGLE_CLOUD_API_KEY is not configured.
 *
 * Environment variables:
 *   - GOOGLE_CLOUD_API_KEY  — dedicated Cloud API key (Speech enabled)
 *   - GOOGLE_API_KEY        — fallback (must have Speech-to-Text enabled)
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type AudioEncoding =
  | 'LINEAR16'
  | 'FLAC'
  | 'MP3'
  | 'OGG_OPUS'
  | 'WEBM_OPUS'
  | 'AMR'
  | 'AMR_WB'
  | 'MULAW'
  | 'ENCODING_UNSPECIFIED';

export interface SpeechConfig {
  /**
   * BCP-47 language code for the primary language being spoken.
   * Defaults to 'en-IN' (English - India).
   */
  languageCode?: string;
  /**
   * Additional alternative language codes the recogniser will consider.
   * Useful for code-switching (e.g. Hinglish). Max 3 alternatives.
   * Defaults to ['en-IN', 'hi-IN'].
   */
  alternativeLanguageCodes?: string[];
  /**
   * Audio encoding format.
   * Defaults to 'WEBM_OPUS' (common browser MediaRecorder format).
   */
  encoding?: AudioEncoding;
  /**
   * Sample rate in Hz. Required for LINEAR16, AMR, AMR_WB encodings.
   * Typically 16000 or 44100.
   */
  sampleRateHertz?: number;
  /**
   * Whether to add automatic punctuation to the transcript.
   * Defaults to true.
   */
  enableAutomaticPunctuation?: boolean;
}

export interface TranscriptionResult {
  /** Full transcript text (may include segments from multiple results). */
  transcript: string;
  /** Confidence score 0.0–1.0 for the first segment. */
  confidence: number;
  /** BCP-47 language code that was detected or confirmed by the API. */
  languageCode: string;
  /** True if a non-empty transcript was obtained. */
  success: boolean;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const SPEECH_API_URL = 'https://speech.googleapis.com/v1/speech:recognize';

/**
 * BCP-47 codes for all major Indian languages supported by Google Speech-to-Text.
 *
 * Covers the 22 constitutionally recognized languages of India plus
 * English (India) and Urdu.
 */
export const INDIAN_LANGUAGE_CODES: ReadonlyArray<string> = [
  'en-IN',  // English (India)
  'hi-IN',  // Hindi
  'bn-IN',  // Bengali
  'ta-IN',  // Tamil
  'te-IN',  // Telugu
  'mr-IN',  // Marathi
  'kn-IN',  // Kannada
  'ml-IN',  // Malayalam
  'gu-IN',  // Gujarati
  'pa-IN',  // Punjabi (Gurmukhi script)
  'or-IN',  // Odia / Oriya
  'as-IN',  // Assamese
  'ur-IN',  // Urdu (India)
  'ne-NP',  // Nepali (widely spoken in north-east India)
  'si-LK',  // Sinhala
];

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function getApiKey(): string | undefined {
  return process.env.GOOGLE_CLOUD_API_KEY ?? process.env.GOOGLE_API_KEY;
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Transcribe base64-encoded audio to text using Google Cloud Speech-to-Text.
 *
 * Returns `{ success: false, transcript: '' }` when:
 *   - No API key is configured
 *   - The audio content is empty / whitespace-only
 *   - The API returns a non-OK status
 *   - The API returns no results or no transcript
 *   - Any network or parsing error occurs
 *
 * @param audioBase64 - Base64-encoded audio (no data-URI prefix)
 * @param config      - Optional speech recognition configuration
 * @returns Transcription result
 */
export async function transcribeAudio(
  audioBase64: string,
  config: SpeechConfig = {},
): Promise<TranscriptionResult> {
  const defaultLanguage = config.languageCode ?? 'en-IN';

  const empty: TranscriptionResult = {
    transcript: '',
    confidence: 0,
    languageCode: defaultLanguage,
    success: false,
  };

  const apiKey = getApiKey();
  if (!apiKey || !audioBase64.trim()) {
    return empty;
  }

  const requestBody = {
    config: {
      encoding: config.encoding ?? 'WEBM_OPUS',
      languageCode: defaultLanguage,
      alternativeLanguageCodes: config.alternativeLanguageCodes ?? ['en-IN', 'hi-IN'],
      enableAutomaticPunctuation: config.enableAutomaticPunctuation ?? true,
      model: 'command_and_search',
      ...(config.sampleRateHertz ? { sampleRateHertz: config.sampleRateHertz } : {}),
    },
    audio: {
      content: audioBase64,
    },
  };

  try {
    const url = `${SPEECH_API_URL}?key=${encodeURIComponent(apiKey)}`;
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return empty;
    }

    const data = await response.json() as {
      results?: Array<{
        alternatives?: Array<{ transcript: string; confidence?: number }>;
        languageCode?: string;
      }>;
    };

    if (!data.results?.length) {
      return empty;
    }

    const firstResult = data.results[0];
    const firstAlt = firstResult.alternatives?.[0];

    if (!firstAlt?.transcript) {
      return empty;
    }

    // Concatenate all result transcripts for multi-segment long-form audio
    const fullTranscript = data.results
      .flatMap(r => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim();

    return {
      transcript: fullTranscript,
      confidence: firstAlt.confidence ?? 0,
      languageCode: firstResult.languageCode ?? defaultLanguage,
      success: true,
    };
  } catch {
    return empty;
  }
}

/**
 * Check whether a BCP-47 language code is in the list of Indian languages
 * supported by LifeBridge for voice transcription.
 *
 * @param code - BCP-47 language code (e.g. 'hi-IN', 'ta-IN')
 * @returns True if the code is in the supported list
 */
export function isSupportedIndianLanguage(code: string): boolean {
  return INDIAN_LANGUAGE_CODES.includes(code);
}
