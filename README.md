# LifeBridge — Emergency Triage & Crisis Response Assistant

A Gemini-powered web application that accepts **chaotic, real-world inputs across text, voice, structured feeds, and photos** and converts them into **structured, actionable emergency response plans**.

## Chosen Vertical

**Emergency Medical & Crisis Triage** — A universal bridge between human intent and complex emergency response systems. LifeBridge accepts any combination of disorganized text describing medical situations, natural disasters, or active emergencies and produces structured, prioritized action plans with severity levels, step-by-step instructions, risk factors, and emergency contacts.

## Approach and Logic

The current pipeline is multi-stage and multi-modal:

1. **Input normalization** — Accepts plain text plus structured JSON payloads (weather, traffic, medical records, public-health reports, IoT sensor data, voice transcripts).
2. **Language bridge** — Detects and translates non-English input to English (best-effort fallback-safe).
3. **Geographic enrichment** — Extracts location mentions, geocodes them, and appends nearby emergency services context.
4. **AI triage generation** — Uses Gemini for structured triage output (text path or image+text path).
5. **Output validation/formatting** — Normalizes severity metadata and response schema.
6. **Optional voice output** — Synthesizes spoken summary for hands-free use.

### Key Design Decisions

- **TypeScript** with strict mode for type safety and maintainability
- **Zero frontend frameworks** — vanilla HTML/CSS/JS for minimal footprint
- **Lean production deps** — `express`, `@google/generative-ai`, and `extract-json-from-string`
- **Node.js built-in test runner** (`node --test`) — zero test framework overhead
- **ESLint (flat config) for TypeScript** with repo-wide `lint` / `lint:fix` scripts
- **Input sanitization** to guard against prompt injection and XSS
- **Safety settings** on all Gemini harm categories (BLOCK_MEDIUM_AND_ABOVE)
- **Rate limiting** to prevent API abuse
- **Memory-bounded telemetry** for operational monitoring

## How the Solution Works

1. User visits the deployed Cloud Run URL
2. The interface presents a large text input area with sample scenario buttons
3. User can paste text, load a scenario, dictate speech, or attach a photo for visual triage
4. The frontend sends the text to `POST /api/triage`
5. Server pipeline: normalize → translate → enrich location → prompt → Gemini → validate → format
6. A structured action plan card is rendered with severity level, findings, steps, warnings, and contacts

### Running Locally

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm run build

# Start server (requires GEMINI_API_KEY)
GEMINI_API_KEY=your_key_here pnpm start

# Optional model override
GEMINI_API_KEY=your_key_here GEMINI_MODEL=gemini-2.5-flash pnpm start
```

### Running Tests

```bash
pnpm run lint
pnpm test
pnpm run typecheck
```

Tests include:
- **Unit tests** for input sanitization, classification, and output formatting
- **Unit tests** for translation, speech-to-text, text-to-speech, location enrichment, and input normalization
- **Integration tests** for HTTP API validation, security headers, and error handling
- **Memory tests** that validate no leaks across 10,000+ iterations of each function

## Assumptions Made

- Users have a modern web browser with JavaScript enabled
- The application is deployed on Google Cloud Run with default configuration
- The `PORT` environment variable is provided by Cloud Run (defaults to 8080)
- `GEMINI_API_KEY` environment variable is set for Gemini API access
- Emergency contact numbers are illustrative; users should verify local numbers
- All AI-generated guidance includes a mandatory medical disclaimer

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20
- **Framework:** Express.js
- **AI:** Google Gemini (default: gemini-2.5-flash via `@google/generative-ai`)
- **Google Services:** Gemini, Translation API, Maps Geocoding/Places, Speech-to-Text, Text-to-Speech
- **Deployment:** Google Cloud Run (Docker)
- **Testing:** Node.js built-in test runner (`node:test`)

## Project Structure

```
lifebridge/
├── src/
│   ├── server.ts                 # Express app entry point
│   ├── services/
│   │   ├── gemini.ts             # Gemini text + vision generation
│   │   ├── inputNormalizer.ts    # Structured payload normalization
│   │   ├── inputProcessor.ts     # Sanitize, classify, build prompts
│   │   ├── translation.ts        # Language detection/translation bridge
│   │   ├── locationEnricher.ts   # Google Maps geocoding + nearby services
│   │   ├── speechToText.ts       # Google STT integration
│   │   ├── textToSpeech.ts       # Google TTS integration
│   │   ├── outputFormatter.ts    # Parse, validate, format action plans
│   │   └── telemetry.ts          # Request monitoring middleware
│   └── tests/
│       ├── inputNormalizer.test.ts
│       ├── inputProcessor.test.ts
│       ├── locationEnricher.test.ts
│       ├── outputFormatter.test.ts
│       ├── server.test.ts
│       ├── speechToText.test.ts
│       ├── textToSpeech.test.ts
│       ├── translation.test.ts
│       └── memory.test.ts
├── public/
│   ├── index.html                # Accessible UI shell
│   ├── styles.css                # Dark theme + interaction styles
│   └── app.js                    # Frontend logic (voice, image upload, triage)
├── package.json
├── eslint.config.mjs
├── tsconfig.json
├── Dockerfile
└── README.md
```
