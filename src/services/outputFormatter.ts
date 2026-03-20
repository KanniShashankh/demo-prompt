/**
 * @module outputFormatter
 * @description Transforms raw Gemini API responses into validated,
 * display-ready action plans with severity metadata.
 *
 * Responsibilities:
 *   1. Parse raw text (handling markdown-wrapped JSON)
 *   2. Validate required fields and normalize values
 *   3. Attach severity display metadata (color, icon, priority)
 *   4. Ensure mandatory disclaimers are present
 */

// ────────────────────────────────────────────────────────────────
// Type definitions
// ────────────────────────────────────────────────────────────────

/** Supported severity levels, ordered by urgency. */
export type SeverityLevel = 'CRITICAL' | 'URGENT' | 'MODERATE' | 'LOW';

/** Display metadata for a severity level. */
export interface SeverityMeta {
  readonly label: string;
  readonly color: string;
  readonly icon: string;
  readonly priority: number;
}

/** A single finding extracted from the input. */
export interface KeyFinding {
  category: string;
  detail: string;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** A prioritized action step in the response. */
export interface ActionStep {
  priority: number;
  action: string;
  reasoning: string;
  timeframe: 'IMMEDIATE' | 'WITHIN_MINUTES' | 'WITHIN_HOURS' | 'WHEN_POSSIBLE';
}

/** An emergency contact recommendation. */
export interface EmergencyContact {
  name: string;
  number: string;
  when: string;
}

/** The structured action plan returned by the pipeline. */
export interface ActionPlan {
  severity: SeverityLevel;
  title: string;
  summary: string;
  keyFindings: KeyFinding[];
  actionSteps: ActionStep[];
  warnings: string[];
  emergencyContacts: EmergencyContact[];
  disclaimer: string;
}

/** Action plan enriched with display metadata. */
export interface FormattedActionPlan extends ActionPlan {
  severityMeta: SeverityMeta;
  formattedAt: string;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

/** Visual configuration for each severity level. */
export const SEVERITY_CONFIG: Record<SeverityLevel, SeverityMeta> = {
  CRITICAL: { label: 'CRITICAL', color: '#ef4444', icon: '🔴', priority: 1 },
  URGENT:   { label: 'URGENT',   color: '#f59e0b', icon: '🟠', priority: 2 },
  MODERATE: { label: 'MODERATE', color: '#3b82f6', icon: '🔵', priority: 3 },
  LOW:      { label: 'LOW',      color: '#22c55e', icon: '🟢', priority: 4 },
};

/** Fields that must be present in a valid action plan. */
export const REQUIRED_FIELDS: readonly (keyof ActionPlan)[] = [
  'severity', 'title', 'summary', 'actionSteps',
] as const;

/** Medical/safety disclaimer added to every response. */
export const DEFAULT_DISCLAIMER =
  'This is AI-generated guidance for informational purposes only. ' +
  'Always consult qualified professionals for medical, emergency, or safety decisions. ' +
  'Call your local emergency number for life-threatening situations.';

// ────────────────────────────────────────────────────────────────
// Parsing
// ────────────────────────────────────────────────────────────────

/**
 * Parse raw Gemini response text into a JavaScript object.
 *
 * Handles common edge cases:
 *   - Response wrapped in ```json ... ``` code fences
 *   - Leading/trailing whitespace
 *   - Empty or non-string input
 *
 * @param rawText - Raw text output from the Gemini API
 * @returns Parsed JSON object
 * @throws {Error} If the input is empty, not a string, or unparseable
 */
export function parseGeminiResponse(rawText: string): Record<string, unknown> {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty or invalid response from AI');
  }

  // Strip markdown code-fence wrappers (```json ... ```)
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error('Failed to parse AI response as structured data');
  }
}

// ────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────

/**
 * Validate an action plan object and fill in missing optional fields.
 *
 * Ensures:
 *   - All {@link REQUIRED_FIELDS} are present
 *   - Severity is normalized to a valid {@link SeverityLevel}
 *   - Array fields default to empty arrays if missing
 *   - Action steps are sorted ascending by priority
 *   - Disclaimer is always present
 *
 * @param plan - Raw parsed action plan object
 * @returns Validated and enriched {@link ActionPlan}
 * @throws {Error} If required fields are missing or plan is invalid
 */
export function validateOutput(plan: unknown): ActionPlan {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Invalid action plan structure');
  }

  const raw = plan as Record<string, unknown>;

  // Check for required fields
  const missingFields = REQUIRED_FIELDS.filter(field => !raw[field]);
  if (missingFields.length > 0) {
    throw new Error(`Action plan missing required fields: ${missingFields.join(', ')}`);
  }

  // Normalize severity to uppercase and validate
  const severityStr = String(raw.severity).toUpperCase() as SeverityLevel;
  const severity: SeverityLevel = SEVERITY_CONFIG[severityStr] ? severityStr : 'MODERATE';

  // Ensure all array fields exist
  const keyFindings = Array.isArray(raw.keyFindings)
    ? (raw.keyFindings as KeyFinding[])
    : [];

  const actionSteps = Array.isArray(raw.actionSteps)
    ? (raw.actionSteps as ActionStep[]).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    : [];

  const warnings = Array.isArray(raw.warnings)
    ? (raw.warnings as string[])
    : [];

  const emergencyContacts = Array.isArray(raw.emergencyContacts)
    ? (raw.emergencyContacts as EmergencyContact[])
    : [];

  return {
    severity,
    title: String(raw.title),
    summary: String(raw.summary),
    keyFindings,
    actionSteps,
    warnings,
    emergencyContacts,
    disclaimer: typeof raw.disclaimer === 'string' ? raw.disclaimer : DEFAULT_DISCLAIMER,
  };
}

// ────────────────────────────────────────────────────────────────
// Formatting
// ────────────────────────────────────────────────────────────────

/**
 * Validate and enrich an action plan with display metadata.
 *
 * Combines validation via {@link validateOutput} with severity
 * display configuration from {@link SEVERITY_CONFIG}.
 *
 * @param plan - Raw parsed action plan (typically from {@link parseGeminiResponse})
 * @returns A {@link FormattedActionPlan} ready for the frontend
 */
export function formatActionPlan(plan: unknown): FormattedActionPlan {
  const validated = validateOutput(plan);
  const severityMeta = SEVERITY_CONFIG[validated.severity] ?? SEVERITY_CONFIG.MODERATE;

  return {
    ...validated,
    severityMeta,
    formattedAt: new Date().toISOString(),
  };
}
