/**
 * @module gemini
 * @description Gemini API client for LifeBridge.
 *
 * Initializes the Google Generative AI SDK with:
 *   - Safety settings on all harm categories (BLOCK_MEDIUM_AND_ABOVE)
 *   - Structured JSON output mode for reliable parsing
 *   - A system instruction tuned for emergency triage
 *
 * Exposes two generation modes:
 *   - `generateTriageResponse` — single-shot, returns parsed JSON
 *   - `streamTriageResponse`  — async generator for streaming chunks
 */

import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type GenerativeModel,
  type Part,
} from '@google/generative-ai';
import extractJsonFromString from 'extract-json-from-string';

// ────────────────────────────────────────────────────────────────
// Module state
// ────────────────────────────────────────────────────────────────

let genAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const BUILTIN_FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];

let activeModelName: string | null = null;
let modelChain: string[] = [];
const modelCache = new Map<string, GenerativeModel>();

// ────────────────────────────────────────────────────────────────
// System prompt
// ────────────────────────────────────────────────────────────────

/**
 * System instruction that guides the Gemini model to act as a
 * structured emergency triage and crisis response assistant.
 *
 * Key behaviors:
 *   - Always responds with valid JSON matching the ActionPlan schema
 *   - Handles ALL input types: plain text, voice transcripts, weather
 *     data, traffic feeds, medical records, news alerts, IoT sensors,
 *     and visual/photo evidence
 *   - Prioritizes life-threatening conditions first
 *   - Flags drug interactions and contraindications
 *   - Includes mandatory medical disclaimers
 */
const SYSTEM_PROMPT = `You are LifeBridge, a universal emergency triage and crisis response AI.

Your purpose is to act as a bridge between chaotic, unstructured real-world inputs — whether text, voice transcripts, weather data, traffic feeds, medical records, news alerts, IoT sensor readings, or visual evidence from photos — and clear, structured, life-saving action plans.

You MUST respond with valid JSON only. No markdown, no extra text. Use this exact schema:

{
  "severity": "CRITICAL" | "URGENT" | "MODERATE" | "LOW",
  "title": "Brief title of the situation",
  "summary": "One-sentence summary of the situation",
  "keyFindings": [
    { "category": "string", "detail": "string", "risk": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "actionSteps": [
    { "priority": 1, "action": "string", "reasoning": "string", "timeframe": "IMMEDIATE" | "WITHIN_MINUTES" | "WITHIN_HOURS" | "WHEN_POSSIBLE" }
  ],
  "warnings": ["string"],
  "emergencyContacts": [
    { "name": "string", "number": "string", "when": "string" }
  ],
  "disclaimer": "This is AI-generated guidance. Always consult qualified professionals for medical or emergency decisions."
}

Rules:
1. ALWAYS prioritize life-threatening conditions first.
2. Flag drug interactions and contraindications.
3. If the input describes an active emergency, the first action MUST be to call emergency services.
4. Be specific and actionable — never say vague things like "seek help".
5. Consider the full context: age, medications, pre-existing conditions, environment.
6. For weather / traffic / sensor data: translate readings into human risk assessments with concrete protective actions.
7. For medical records or voice transcripts: extract all clinical details and flag critical interactions.
8. For news alerts or public-health reports: identify population at risk and containment priorities.
9. For photos or visual descriptions: describe what you observe and translate it into safety actions.
10. If the input is not an emergency, still provide structured, helpful guidance.
11. ALWAYS include the disclaimer field.`;

// ────────────────────────────────────────────────────────────────
// Initialization
// ────────────────────────────────────────────────────────────────

/**
 * Initialize the Gemini client using an API key from the environment.
 *
 * Reads `GEMINI_API_KEY` or `GOOGLE_API_KEY` (in that order).
 * Configures the model with strict safety filters and JSON output mode.
 *
 * @returns `true` if initialization succeeded, `false` otherwise
 */
export function initializeGemini(): boolean {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const modelName = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  if (!apiKey) {
    console.warn('[Gemini] No API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY env var.');
    return false;
  }

  try {
    genAI = new GoogleGenerativeAI(apiKey);
    modelCache.clear();
    modelChain = buildModelFallbackChain(modelName);
    activeModelName = modelChain[0] ?? modelName;
    model = getOrCreateModel(activeModelName);

    const fallbackText = modelChain.length > 1
      ? ` (fallbacks: ${modelChain.slice(1).join(', ')})`
      : '';
    console.log(`[Gemini] Initialized successfully with ${activeModelName}${fallbackText}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Gemini] Initialization failed:', message);
    return false;
  }
}

// ────────────────────────────────────────────────────────────────
// Generation
// ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeActionPlan(obj: Record<string, unknown>): boolean {
  return ['severity', 'title', 'summary', 'actionSteps'].every((key) => key in obj);
}

function extractPlanCandidates(value: unknown): Record<string, unknown>[] {
  if (isRecord(value)) {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  return [];
}

/**
 * Parse model output text into a structured object using a JSON extraction library.
 *
 * The model can still return prose and markdown fences around JSON despite
 * `responseMimeType: 'application/json'`, so we extract JSON candidates safely.
 */
export function parseTriageJsonResponse(raw: string): Record<string, unknown> {
  const text = raw?.trim();
  if (!text) {
    throw new SyntaxError('Empty model response');
  }

  const candidates = extractJsonFromString(text).flatMap(extractPlanCandidates);
  if (candidates.length === 0) {
    throw new SyntaxError('No JSON object found in model response');
  }

  return candidates.find(looksLikeActionPlan) ?? candidates[0];
}

function splitModelList(csv: string | undefined): string[] {
  if (!csv) {
    return [];
  }

  return csv
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function buildModelFallbackChain(primaryModel: string, fallbackCsv: string | undefined = process.env.GEMINI_FALLBACK_MODELS): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const addUnique = (modelName: string): void => {
    if (!modelName || seen.has(modelName)) {
      return;
    }
    seen.add(modelName);
    ordered.push(modelName);
  };

  addUnique(primaryModel);
  for (const configuredFallback of splitModelList(fallbackCsv)) {
    addUnique(configuredFallback);
  }
  for (const builtinFallback of BUILTIN_FALLBACK_MODELS) {
    addUnique(builtinFallback);
  }

  return ordered;
}

export function isRateLimitOrQuotaError(message: string): boolean {
  return /\b429\b|rate\s*limit|too\s*many\s*requests|quota\s*exceeded/i.test(message);
}

function isModelUnavailableError(message: string): boolean {
  return /\b404\b|not\s*found|does\s*not\s*exist|unsupported|not\s*available|access\s*denied|permission\s*denied/i.test(message);
}

function getOrCreateModel(modelName: string): GenerativeModel {
  if (!genAI) {
    throw new Error('Gemini client is not initialized.');
  }

  const cached = modelCache.get(modelName);
  if (cached) {
    return cached;
  }

  const created = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.8,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  modelCache.set(modelName, created);
  return created;
}

async function runWithModelFallback<T>(operation: (activeModel: GenerativeModel) => Promise<T>): Promise<T> {
  if (!model || !activeModelName) {
    throw new Error('Gemini is not initialized. Check your API key configuration.');
  }

  const candidates = modelChain.length > 0 ? modelChain : [activeModelName];
  let rateLimitError: Error | null = null;

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const candidateName = candidates[idx] as string;
    const fallbackAttempt = idx > 0;

    try {
      const candidateModel = getOrCreateModel(candidateName);
      const result = await operation(candidateModel);

      if (activeModelName !== candidateName) {
        activeModelName = candidateName;
        model = candidateModel;
        console.warn(`[Gemini] Switched active model to ${candidateName} after rate-limit fallback.`);
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isRateLimitOrQuotaError(message)) {
        rateLimitError = error instanceof Error ? error : new Error(message);
        if (idx < candidates.length - 1) {
          const nextModel = candidates[idx + 1] as string;
          console.warn(`[Gemini] Model ${candidateName} is rate-limited. Retrying with ${nextModel}.`);
          continue;
        }
        break;
      }

      if (fallbackAttempt && isModelUnavailableError(message)) {
        if (idx < candidates.length - 1) {
          const nextModel = candidates[idx + 1] as string;
          console.warn(`[Gemini] Model ${candidateName} unavailable. Trying ${nextModel}.`);
          continue;
        }

        if (rateLimitError) {
          console.warn(`[Gemini] Model ${candidateName} unavailable after rate-limit fallback attempts.`);
          break;
        }
      }

      throw error;
    }
  }

  throw new Error('Rate limited across all configured Gemini models. Please wait a few seconds and try again.', {
    cause: rateLimitError ?? undefined,
  });
}

/**
 * Send a prompt to Gemini and receive a structured JSON response.
 *
 * @param prompt - Context-enriched prompt built by {@link buildContextPrompt}
 * @returns Parsed JSON object from the Gemini response
 * @throws {Error} If Gemini is not initialized, the response can't be parsed,
 *                 or the content was blocked by safety filters
 */
export async function generateTriageResponse(prompt: string): Promise<Record<string, unknown>> {
  if (!model) {
    throw new Error('Gemini is not initialized. Check your API key configuration.');
  }

  try {
    return await runWithModelFallback(async (activeModel) => {
      const result = await activeModel.generateContent(prompt);
      const response = result.response;
      const raw = response.text();
      return parseTriageJsonResponse(raw);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse Gemini response as structured data. ${message}`, { cause: error });
    }
    if (message.includes('SAFETY')) {
      throw new Error('The input was flagged by safety filters. Please rephrase your input.', { cause: error });
    }
    if (isRateLimitOrQuotaError(message)) {
      throw new Error('Rate limited across available AI models. Please wait a few seconds and try again.', { cause: error });
    }
    throw new Error(`Gemini API error: ${message}`, { cause: error });
  }
}

/**
 * Send a prompt together with an inline image to Gemini Vision and receive
 * a structured JSON triage response.
 *
 * Accepts base64-encoded image data directly — no Storage dependency.
 *
 * @param prompt     - Context-enriched text prompt
 * @param imageBase64 - Base64-encoded image (without the data-URI prefix)
 * @param mimeType   - Image MIME type (default: 'image/jpeg')
 * @returns Parsed JSON triage object
 * @throws {Error} If Gemini is not initialized or the response can't be parsed
 */
export async function generateImageTriageResponse(
  prompt: string,
  imageBase64: string,
  mimeType: string = 'image/jpeg',
): Promise<Record<string, unknown>> {
  if (!model) {
    throw new Error('Gemini is not initialized. Check your API key configuration.');
  }

  const parts: Part[] = [
    { text: prompt },
    { inlineData: { mimeType, data: imageBase64 } },
  ];

  try {
    return await runWithModelFallback(async (activeModel) => {
      const result = await activeModel.generateContent({ contents: [{ role: 'user', parts }] });
      const raw = result.response.text();
      return parseTriageJsonResponse(raw);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse Gemini Vision response as structured data. ${message}`, { cause: error });
    }
    if (message.includes('SAFETY')) {
      throw new Error('The image was flagged by safety filters.', { cause: error });
    }
    if (isRateLimitOrQuotaError(message)) {
      throw new Error('Rate limited across available AI models. Please wait a few seconds and try again.', { cause: error });
    }
    throw new Error(`Gemini Vision API error: ${message}`, { cause: error });
  }
}

/**
 * Stream a response from Gemini for real-time UI updates.
 *
 * Yields text chunks as they arrive from the model.
 *
 * @param prompt - Context-enriched prompt
 * @yields {string} Individual text chunks
 * @throws {Error} If Gemini is not initialized
 */
export async function* streamTriageResponse(prompt: string): AsyncGenerator<string> {
  if (!model) {
    throw new Error('Gemini is not initialized. Check your API key configuration.');
  }

  try {
    const result = await runWithModelFallback((activeModel) => activeModel.generateContentStream(prompt));

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('SAFETY')) {
      throw new Error('The input was flagged by safety filters. Please rephrase your input.', { cause: error });
    }
    if (isRateLimitOrQuotaError(message)) {
      throw new Error('Rate limited across available AI models. Please wait a few seconds and try again.', { cause: error });
    }
    throw new Error(`Gemini stream API error: ${message}`, { cause: error });
  }
}
