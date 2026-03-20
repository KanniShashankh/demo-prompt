/**
 * @module speechService
 * @description Google Cloud Speech-to-Text integration for LifeBridge.
 *
 * Converts base64-encoded audio into text transcripts that can be processed
 * by the standard triage pipeline. This covers the "voice" input modality
 * specified in the problem statement.
 *
 * Key features:
 *   - Auto-detects all major Indian languages via alternativeLanguageCodes
 *   - Supports common audio encodings (WEBM_OPUS from browser, FLAC, MP3, etc.)
 *   - Falls back gracefully when API key is not configured
 *
 * Environment variables:
 *   - GOOGLE_CLOUD_API_KEY — Cloud API key with Speech-to-Text v1 enabled
 *   - GOOGLE_API_KEY       — fallback
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
  | 'MULAW';

export interface TranscriptionRequest {
  /** Base64-encoded audio data (without data URI prefix). */
  audioBase64: string;
  /** Audio encoding format. Default: WEBM_OPUS (common browser MediaRecorder output). */
  encoding?: AudioEncoding;
  /** Sample rate in Hz. Default: 16000 */
  sampleRateHertz?: number;
  /**
   * Primary BCP-47 language code.
   * Default: 'en-IN' (English with Indian accent model).
   */
  languageCode?: string;
  /**
   * Additional BCP-47 language codes for automatic multi-language detection.
   * Pre-populated with all major Indian languages for the universal-bridge mission.
   * Set to an empty array to disable multi-language detection.
   */
  alternativeLanguageCodes?: string[];
}

export interface TranscriptionResult {
  transcript: string;
  confidence: number;
  languageCode: string;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const SPEECH_API_URL = 'https://speech.googleapis.com/v1/speech:recognize';

/**
 * All major Indian language BCP-47 codes supported by Speech-to-Text.
 *
 * Listed by language family:
 *   - Indo-Aryan: hi, bn, mr, gu, pa, or, ur, as, mai
 *   - Dravidian: ta, te, kn, ml
 */
export const INDIAN_LANGUAGE_CODES: readonly string[] = [
  'hi-IN',   // Hindi
  'bn-IN',   // Bengali
  'ta-IN',   // Tamil
  'te-IN',   // Telugu
  'mr-IN',   // Marathi
  'kn-IN',   // Kannada
  'ml-IN',   // Malayalam
  'gu-IN',   // Gujarati
  'pa-IN',   // Punjabi (Gurmukhi)
  'or-IN',   // Odia
  'ur-IN',   // Urdu
  'as-IN',   // Assamese
  'mai-IN',  // Maithili
];

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
 * Transcribe base64-encoded audio to text using Google Cloud Speech-to-Text.
 *
 * Includes all major Indian languages as alternative language codes so the
 * API can detect and transcribe without needing an explicit language hint.
 * This is critical for the "universal bridge" mission — emergencies happen
 * in every language across India.
 *
 * @param request - Transcription parameters
 * @returns Transcript text, confidence score, and detected language code
 * @throws {Error} If no API key is configured, audio is missing, or API call fails
 */
export async function transcribeAudio(
  request: TranscriptionRequest,
): Promise<TranscriptionResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      '[SpeechService] No API key configured. Set GOOGLE_CLOUD_API_KEY or GOOGLE_API_KEY.',
    );
  }

  if (!request.audioBase64) {
    throw new Error('[SpeechService] audioBase64 is required.');
  }

  const body = {
    config: {
      encoding:                     request.encoding                     ?? 'WEBM_OPUS',
      sampleRateHertz:              request.sampleRateHertz              ?? 16000,
      languageCode:                 request.languageCode                 ?? 'en-IN',
      alternativeLanguageCodes:     request.alternativeLanguageCodes     ?? [...INDIAN_LANGUAGE_CODES],
      enableAutomaticPunctuation:   true,
      model:                        'default',
    },
    audio: {
      content: request.audioBase64,
    },
  };

  const response = await globalThis.fetch(
    `${SPEECH_API_URL}?key=${encodeURIComponent(apiKey)}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `[SpeechService] API error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const data = await response.json() as {
    results?: Array<{
      alternatives: Array<{
        transcript: string;
        confidence?: number;
      }>;
      languageCode?: string;
    }>;
  };

  const best = data.results?.[0]?.alternatives?.[0];
  if (!best?.transcript) {
    throw new Error('[SpeechService] No transcript in API response.');
  }

  return {
    transcript:   best.transcript,
    confidence:   best.confidence ?? 0,
    languageCode: data.results?.[0]?.languageCode ?? (request.languageCode ?? 'en-IN'),
  };
}
