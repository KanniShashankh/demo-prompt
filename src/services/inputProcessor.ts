/**
 * @module inputProcessor
 * @description Input processing pipeline for LifeBridge.
 *
 * Provides pure, side-effect-free functions to:
 *   1. Sanitize raw user input (strip HTML, limit length, escape XSS vectors)
 *   2. Classify input type (medical, disaster, emergency, general) via keyword scoring
 *   3. Build context-enriched prompts for the Gemini model
 *
 * All functions are deterministic and fully testable.
 */

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Maximum allowed input length in characters. */
export const MAX_INPUT_LENGTH = 5000;

/** Recognized input categories. */
export type InputType = 'medical' | 'disaster' | 'emergency' | 'general';

// ────────────────────────────────────────────────────────────────
// Keyword dictionaries for classification
// ────────────────────────────────────────────────────────────────

const MEDICAL_KEYWORDS: readonly string[] = [
  'symptom', 'pain', 'blood', 'medication', 'medicine', 'doctor',
  'hospital', 'diagnosis', 'fever', 'cough', 'breathing', 'heart',
  'diabetic', 'diabetes', 'pressure', 'allergy', 'allergic', 'injury',
  'surgery', 'prescription', 'dose', 'mg', 'tablet', 'insulin',
  'patient', 'condition', 'chronic', 'acute', 'fracture', 'wound',
] as const;

const DISASTER_KEYWORDS: readonly string[] = [
  'flood', 'earthquake', 'fire', 'storm', 'hurricane', 'tornado',
  'tsunami', 'evacuation', 'shelter', 'stranded', 'rescue', 'collapse',
  'power outage', 'blackout', 'landslide', 'cyclone', 'drought',
] as const;

const EMERGENCY_KEYWORDS: readonly string[] = [
  'accident', 'crash', 'unconscious', 'not breathing', 'choking',
  'bleeding', 'fallen', 'attacked', 'gunshot', 'stabbed', 'drowning',
  'overdose', 'seizure', 'stroke', 'heart attack', 'anaphylaxis',
  'burns', 'electrocution', 'poisoning', 'cardiac arrest',
] as const;

// ────────────────────────────────────────────────────────────────
// Sanitization
// ────────────────────────────────────────────────────────────────

/**
 * Sanitize raw user input for safe downstream processing.
 *
 * Steps performed:
 *   1. Reject non-string / falsy input → return empty string
 *   2. Strip all HTML tags (prevents stored XSS)
 *   3. Remove angle-brackets and quote characters
 *   4. Collapse multiple whitespace characters into a single space
 *   5. Trim leading/trailing whitespace
 *   6. Truncate to {@link MAX_INPUT_LENGTH}
 *
 * @param text - Raw, untrusted user input
 * @returns Sanitized string safe for prompt injection
 */
export function sanitizeInput(text: unknown): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/<[^>]*>/g, '')       // Strip HTML tags
    .replace(/[<>'"]/g, '')        // Remove residual XSS chars
    .replace(/\s+/g, ' ')         // Normalize whitespace
    .trim()
    .slice(0, MAX_INPUT_LENGTH);
}

// ────────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────────

/**
 * Classify unstructured text into one of four categories.
 *
 * Uses a simple keyword-frequency scoring model:
 *   - Count matching keywords for each category
 *   - Highest score wins; ties favor emergency > disaster > medical
 *   - Zero matches across all categories → 'general'
 *
 * @param text - Sanitized user input (lowercase comparison is internal)
 * @returns The classified {@link InputType}
 */
export function classifyInputType(text: string): InputType {
  if (!text) return 'general';

  const lower = text.toLowerCase();

  // Count keyword hits per category
  const medicalScore = MEDICAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const disasterScore = DISASTER_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const emergencyScore = EMERGENCY_KEYWORDS.filter(kw => lower.includes(kw)).length;

  const maxScore = Math.max(medicalScore, disasterScore, emergencyScore);

  // No keywords matched at all
  if (maxScore === 0) return 'general';

  // Priority: emergency > disaster > medical (in case of ties)
  if (emergencyScore === maxScore) return 'emergency';
  if (disasterScore === maxScore) return 'disaster';
  return 'medical';
}

// ────────────────────────────────────────────────────────────────
// Prompt construction
// ────────────────────────────────────────────────────────────────

/** Context-specific instruction prefixes for each input type. */
const CONTEXT_PREFIXES: Record<InputType, string> = {
  medical:
    'The following is unstructured medical information from a concerned person. ' +
    'Extract all medical details (symptoms, medications, conditions, vitals, age, history) ' +
    'and provide a structured triage assessment:',

  disaster:
    'The following is a chaotic disaster situation report. ' +
    'Extract all critical details (location, people affected, infrastructure damage, ' +
    'immediate risks, resource needs) and provide a structured emergency response plan:',

  emergency:
    'The following describes an active emergency. This is TIME-CRITICAL. ' +
    'Extract all details (what happened, who is affected, current condition, location, hazards) ' +
    'and provide IMMEDIATE structured action steps:',

  general:
    'The following is an unstructured description of a situation that may need attention. ' +
    'Analyze it and provide a structured assessment with recommended actions:',
};

/**
 * Build a context-enriched prompt for the Gemini model.
 *
 * Combines a category-specific instruction prefix with the user's
 * sanitized input to guide the model toward the correct output schema.
 *
 * @param sanitizedText - Output of {@link sanitizeInput}
 * @param inputType - Output of {@link classifyInputType}
 * @returns A complete prompt string ready for the Gemini API
 */
export function buildContextPrompt(sanitizedText: string, inputType: InputType): string {
  const prefix = CONTEXT_PREFIXES[inputType] ?? CONTEXT_PREFIXES.general;

  return [
    prefix,
    '',
    '---',
    'INPUT:',
    sanitizedText,
    '---',
    '',
    'Provide your structured JSON triage response.',
  ].join('\n');
}
