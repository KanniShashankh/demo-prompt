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

/**
 * Recognized input categories.
 * Spans the full range of real-world messy inputs LifeBridge handles:
 * from acute medical emergencies through environmental and infrastructure crises.
 */
export type InputType =
  | 'medical'
  | 'disaster'
  | 'emergency'
  | 'traffic'
  | 'weather'
  | 'news'
  | 'public-health'
  | 'infrastructure'
  | 'general';

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

const TRAFFIC_KEYWORDS: readonly string[] = [
  'traffic', 'vehicle', 'road', 'highway', 'intersection', 'collision',
  'car crash', 'truck', 'pedestrian', 'cyclist', 'lane', 'bridge closure',
  'road block', 'congestion', 'pile-up', 'hit and run', 'road accident',
  'motorway', 'junction', 'detour', 'road closure',
] as const;

const WEATHER_KEYWORDS: readonly string[] = [
  'temperature', 'humidity', 'wind', 'rain', 'snow', 'hail', 'fog',
  'blizzard', 'thunderstorm', 'lightning', 'heat wave', 'cold snap',
  'weather alert', 'weather warning', 'extreme cold', 'extreme heat',
  'uv index', 'wildfire smoke', 'air quality', 'frost', 'ice storm',
] as const;

const NEWS_KEYWORDS: readonly string[] = [
  'breaking news', 'headline', 'reporter', 'eyewitness', 'bulletin',
  'alert bulletin', 'news alert', 'media report', 'press release',
  'live update', 'developing story', 'reported at', 'source says',
  'official statement', 'situation update',
] as const;

const PUBLIC_HEALTH_KEYWORDS: readonly string[] = [
  'outbreak', 'disease', 'epidemic', 'pandemic', 'contamination',
  'water contamination', 'food poisoning', 'infection', 'quarantine',
  'virus', 'bacteria', 'exposure', 'airborne', 'contagious', 'health alert',
  'public health', 'vaccination', 'immunization', 'community spread',
] as const;

const INFRASTRUCTURE_KEYWORDS: readonly string[] = [
  'power outage', 'blackout', 'water main', 'gas leak', 'pipeline',
  'dam', 'levee', 'bridge failure', 'building collapse', 'structural',
  'utility', 'sewage', 'electricity', 'grid failure', 'tower collapse',
  'communication failure', 'telecom', 'infrastructure', 'network outage',
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
 * Classify unstructured text into one of the supported emergency categories.
 *
 * Uses a simple keyword-frequency scoring model:
 *   - Count matching keywords for each category
 *   - Highest score wins; ties follow a deterministic priority order
 *   - Zero matches across all categories → 'general'
 *
 * @param text - Sanitized user input (lowercase comparison is internal)
 * @returns The classified {@link InputType}
 */
export function classifyInputType(text: string): InputType {
  if (!text) return 'general';

  const lower = text.toLowerCase();

  // Count keyword hits per category
  const medicalScore        = MEDICAL_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const disasterScore       = DISASTER_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const emergencyScore      = EMERGENCY_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const trafficScore        = TRAFFIC_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const weatherScore        = WEATHER_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const newsScore           = NEWS_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const publicHealthScore   = PUBLIC_HEALTH_KEYWORDS.filter(kw => lower.includes(kw)).length;
  const infrastructureScore = INFRASTRUCTURE_KEYWORDS.filter(kw => lower.includes(kw)).length;

  const maxScore = Math.max(
    medicalScore, disasterScore, emergencyScore,
    trafficScore, weatherScore, newsScore, publicHealthScore, infrastructureScore,
  );

  // No keywords matched at all
  if (maxScore === 0) return 'general';

  // Priority on ties: emergency > disaster > traffic > medical > infrastructure > public-health > news > weather
  if (emergencyScore      === maxScore) return 'emergency';
  if (disasterScore       === maxScore) return 'disaster';
  if (trafficScore        === maxScore) return 'traffic';
  if (medicalScore        === maxScore) return 'medical';
  if (infrastructureScore === maxScore) return 'infrastructure';
  if (publicHealthScore   === maxScore) return 'public-health';
  if (newsScore           === maxScore) return 'news';
  return 'weather';
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

  traffic:
    'The following is a traffic incident report (may include sensor data, feeds, or a witness account). ' +
    'Extract all details (vehicles, casualties, road hazards, blockage, affected routes) ' +
    'and provide a structured traffic emergency response plan with routing and rescue priorities:',

  weather:
    'The following contains weather data or a weather-related alert. ' +
    'Extract all details (conditions, temperatures, wind, precipitation, active alerts) ' +
    'and identify any life-threatening risks to people, infrastructure, or agriculture. ' +
    'Provide a structured safety action plan:',

  news:
    'The following is an unstructured news or social alert report. ' +
    'Extract verified actionable facts (who/what/where/when, affected population, confirmed hazards, confidence level) ' +
    'and convert it into a structured emergency triage plan, clearly separating confirmed facts from uncertain claims:',

  'public-health':
    'The following describes a public health situation (outbreak, contamination, or health alert). ' +
    'Extract all epidemiological details (affected population, symptoms, exposure pathways, location) ' +
    'and provide a structured public health response plan with containment and treatment priorities:',

  infrastructure:
    'The following reports an infrastructure failure or utility emergency ' +
    '(power outage, gas leak, water main, structural collapse, etc.). ' +
    'Extract all details (location, scope of failure, affected services, hazards) ' +
    'and provide a structured infrastructure emergency response plan:',

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
