/**
 * @module ttsService
 * @description Google Cloud Text-to-Speech integration for LifeBridge.
 *
 * Converts action-plan summaries to audio — the "voice output" modality.
 * Critical for first responders who cannot read a screen while driving,
 * operating equipment, or under extreme stress.
 *
 * Returns base64-encoded MP3 audio that can be played directly in the
 * browser with a <audio> element using a data URI.
 *
 * Supports Indian language voices (hi-IN, ta-IN, te-IN, kn-IN, ml-IN, etc.)
 * so the response can be spoken in the user's native language.
 *
 * Environment variables:
 *   - GOOGLE_CLOUD_API_KEY — Cloud API key with Text-to-Speech v1 enabled
 *   - GOOGLE_API_KEY       — fallback
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type AudioOutputEncoding = 'MP3' | 'OGG_OPUS' | 'LINEAR16' | 'MULAW';
export type SsmlGender          = 'NEUTRAL' | 'MALE' | 'FEMALE';

export interface SynthesisRequest {
  /** Text to synthesize. Must be non-empty. */
  text: string;
  /**
   * BCP-47 language code for the output voice.
   * Use 'hi-IN' for Hindi, 'ta-IN' for Tamil, 'kn-IN' for Kannada, etc.
   * Default: 'en-US'
   */
  languageCode?: string;
  gender?:       SsmlGender;
  /** Output audio encoding. Default: MP3 */
  encoding?:     AudioOutputEncoding;
  /** Speaking rate multiplier (0.25–4.0). Default: 1.0 */
  speakingRate?: number;
}

export interface SynthesisResult {
  /** Base64-encoded audio content — embed directly in a data URI. */
  audioBase64:  string;
  /** MIME type matching the chosen encoding. */
  mimeType:     string;
  languageCode: string;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const TTS_API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** Maps AudioOutputEncoding values to their HTTP content-type equivalents. */
export const ENCODING_MIME: Readonly<Record<AudioOutputEncoding, string>> = {
  MP3:      'audio/mpeg',
  OGG_OPUS: 'audio/ogg',
  LINEAR16: 'audio/wav',
  MULAW:    'audio/basic',
};

/**
 * Mapping from two-letter language codes (as detected by Translation API)
 * to BCP-47 locale codes supported by Cloud TTS Indian voices.
 */
export const LANG_TO_TTS_LOCALE: Readonly<Record<string, string>> = {
  hi:  'hi-IN',
  bn:  'bn-IN',
  ta:  'ta-IN',
  te:  'te-IN',
  mr:  'mr-IN',
  kn:  'kn-IN',
  ml:  'ml-IN',
  gu:  'gu-IN',
  pa:  'pa-IN',
  ur:  'ur-IN',
  en:  'en-US',
};

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
 * Synthesize text to speech using Google Cloud Text-to-Speech.
 *
 * @param request - Synthesis parameters (text, language, gender, encoding)
 * @returns Base64-encoded audio ready to embed in a data URI
 * @throws {Error} If no API key is configured, text is empty, or API call fails
 */
export async function synthesizeSpeech(
  request: SynthesisRequest,
): Promise<SynthesisResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      '[TTSService] No API key configured. Set GOOGLE_CLOUD_API_KEY or GOOGLE_API_KEY.',
    );
  }

  if (!request.text?.trim()) {
    throw new Error('[TTSService] text is required and must be non-empty.');
  }

  const encoding    = request.encoding    ?? 'MP3';
  const languageCode = request.languageCode ?? 'en-US';

  const body = {
    input:       { text: request.text },
    voice: {
      languageCode,
      ssmlGender: request.gender ?? 'NEUTRAL',
    },
    audioConfig: {
      audioEncoding: encoding,
      speakingRate:  request.speakingRate ?? 1.0,
    },
  };

  const response = await globalThis.fetch(
    `${TTS_API_URL}?key=${encodeURIComponent(apiKey)}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `[TTSService] API error ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const data = await response.json() as { audioContent?: string };
  if (!data.audioContent) {
    throw new Error('[TTSService] No audio content in API response.');
  }

  return {
    audioBase64:  data.audioContent,
    mimeType:     ENCODING_MIME[encoding],
    languageCode,
  };
}
