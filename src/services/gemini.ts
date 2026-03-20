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
} from '@google/generative-ai';

// ────────────────────────────────────────────────────────────────
// Module state
// ────────────────────────────────────────────────────────────────

let genAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;
const DEFAULT_MODEL = 'gemini-2.5-flash';

// ────────────────────────────────────────────────────────────────
// System prompt
// ────────────────────────────────────────────────────────────────

/**
 * System instruction that guides the Gemini model to act as a
 * structured emergency triage and crisis response assistant.
 *
 * Key behaviors:
 *   - Always responds with valid JSON matching the ActionPlan schema
 *   - Prioritizes life-threatening conditions first
 *   - Flags drug interactions and contraindications
 *   - Includes mandatory medical disclaimers
 */
const SYSTEM_PROMPT = `You are LifeBridge, an emergency triage and crisis response AI. Your role is to take chaotic, unstructured, real-world input and convert it into a clear, structured, life-saving action plan.

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
6. If the input is not an emergency, still provide structured, helpful guidance.
7. ALWAYS include the disclaimer field.`;

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
    model = genAI.getGenerativeModel({
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

    console.log(`[Gemini] Initialized successfully with ${modelName}`);
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
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse the JSON response (Gemini is configured for JSON output)
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse Gemini response as structured data.');
    }
    if (message.includes('SAFETY')) {
      throw new Error('The input was flagged by safety filters. Please rephrase your input.');
    }
    throw new Error(`Gemini API error: ${message}`);
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

  const result = await model.generateContentStream(prompt);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      yield text;
    }
  }
}
