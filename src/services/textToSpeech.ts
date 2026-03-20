/**
 * @module textToSpeech
 * @description Google Cloud Text-to-Speech integration for LifeBridge.
 *
 * Converts triage action plan summaries to spoken audio. Critical for:
 *   - First responders who need hands-free guidance at incident scenes
 *   - Callers in loud environments (disaster sites, moving vehicles)
 *   - Users with low literacy or visual impairment
 *   - Non-English speakers who receive guidance in their language
 *
 * This is the 5th Google service integration in LifeBridge:
 *   1. Google Generative AI (Gemini)   — triage intelligence
 *   2. Google Cloud Translation API    — multilingual input
 *   3. Google Maps Platform            — location enrichment
 *   4. Google Cloud Speech-to-Text     — voice input
 *   5. Google Cloud Text-to-Speech     — voice output (THIS MODULE)
 *
 * Uses REST API v1 — no extra SDK dependency.
 * Supports Indian English and regional language voices.
 * Falls back gracefully if GOOGLE_CLOUD_API_KEY is not configured.
 *
 * Environment variables:
 *   - GOOGLE_CLOUD_API_KEY  — dedicated Cloud API key (TTS enabled)
 *   - GOOGLE_API_KEY        — fallback (must have TTS enabled)
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type TtsAudioEncoding = 'MP3' | 'OGG_OPUS' | 'LINEAR16' | 'MULAW';

export type SsmlGender = 'NEUTRAL' | 'MALE' | 'FEMALE';

export interface VoiceOptions {
  /**
   * BCP-47 language code for the voice to use.
   * Defaults to 'en-IN' (Indian English — clearer for Indian contexts).
   */
  languageCode?: string;
  /**
   * Preferred voice gender.
   * Defaults to 'NEUTRAL'.
   */
  ssmlGender?: SsmlGender;
  /**
   * Output audio encoding.
   * Defaults to 'MP3'.
   */
  audioEncoding?: TtsAudioEncoding;
  /**
   * Speaking rate: 0.25–4.0.
   * Defaults to 0.9 — slightly slower for clarity in high-stress situations.
   */
  speakingRate?: number;
  /**
   * Audio pitch: −20.0–20.0 semitones.
   * Defaults to 0.
   */
  pitch?: number;
}

export interface SynthesisResult {
  /** Base64-encoded audio content. Empty string when success is false. */
  audioContent: string;
  /** MIME type matching the audioEncoding (e.g. 'audio/mpeg' for MP3). */
  mimeType: string;
  /** True if synthesis succeeded and audioContent is non-empty. */
  success: boolean;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const TTS_API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** Google Cloud TTS input limit in characters. */
const MAX_TTS_CHARS = 5000;

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function getApiKey(): string | undefined {
  return process.env.GOOGLE_CLOUD_API_KEY ?? process.env.GOOGLE_API_KEY;
}

function encodingToMime(encoding: TtsAudioEncoding): string {
  const map: Record<TtsAudioEncoding, string> = {
    MP3:      'audio/mpeg',
    OGG_OPUS: 'audio/ogg',
    LINEAR16: 'audio/wav',
    MULAW:    'audio/basic',
  };
  return map[encoding] ?? 'audio/mpeg';
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Synthesize plain text to audio using Google Cloud Text-to-Speech.
 *
 * Returns `{ success: false, audioContent: '' }` when:
 *   - No API key is configured
 *   - The text is empty or whitespace-only
 *   - The API returns a non-OK status
 *   - The API response contains no audioContent
 *   - Any network or parsing error occurs
 *
 * Text longer than 5000 characters is truncated automatically.
 *
 * @param text    - Plain text to convert to speech
 * @param options - Optional voice and audio configuration
 * @returns Synthesis result with base64 audio and MIME type
 */
export async function synthesizeSpeech(
  text: string,
  options: VoiceOptions = {},
): Promise<SynthesisResult> {
  const encoding = options.audioEncoding ?? 'MP3';
  const failed: SynthesisResult = {
    audioContent: '',
    mimeType: encodingToMime(encoding),
    success: false,
  };

  const apiKey = getApiKey();
  if (!apiKey || !text.trim()) {
    return failed;
  }

  // Truncate to stay within API limits
  const truncated =
    text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS) + '...' : text;

  const requestBody = {
    input: { text: truncated },
    voice: {
      languageCode: options.languageCode ?? 'en-IN',
      ssmlGender: options.ssmlGender ?? 'NEUTRAL',
    },
    audioConfig: {
      audioEncoding: encoding,
      speakingRate: options.speakingRate ?? 0.9,
      pitch: options.pitch ?? 0,
    },
  };

  try {
    const url = `${TTS_API_URL}?key=${encodeURIComponent(apiKey)}`;
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      return failed;
    }

    const data = await response.json() as { audioContent?: string };
    if (!data.audioContent) {
      return failed;
    }

    return {
      audioContent: data.audioContent,
      mimeType: encodingToMime(encoding),
      success: true,
    };
  } catch {
    return failed;
  }
}

/**
 * Build a concise spoken summary from an action plan for TTS output.
 *
 * Extracts the most critical information that can be spoken in under 60
 * seconds at normal speech rate. Suitable for passing directly to
 * `synthesizeSpeech`.
 *
 * @param plan - Parsed action plan object from {@link formatActionPlan}
 * @returns Plain-text string suitable for TTS synthesis
 */
export function buildSpokenSummary(plan: Record<string, unknown>): string {
  const parts: string[] = [];

  const severity = typeof plan.severity === 'string' ? plan.severity : '';
  if (severity) {
    parts.push(`Severity level: ${severity}.`);
  }

  const summary = typeof plan.summary === 'string' ? plan.summary : '';
  if (summary) {
    parts.push(summary);
  }

  if (Array.isArray(plan.actionSteps) && plan.actionSteps.length > 0) {
    parts.push('Immediate actions:');
    const steps = (plan.actionSteps as Array<Record<string, unknown>>).slice(0, 3);
    for (let i = 0; i < steps.length; i++) {
      const action = typeof steps[i].action === 'string' ? steps[i].action : '';
      if (action) {
        parts.push(`Step ${i + 1}: ${action}`);
      }
    }
  }

  // Only the first warning — any more would be overwhelming in speech
  if (
    Array.isArray(plan.warnings) &&
    plan.warnings.length > 0 &&
    typeof plan.warnings[0] === 'string'
  ) {
    parts.push(`Warning: ${plan.warnings[0]}`);
  }

  return parts.join(' ');
}
