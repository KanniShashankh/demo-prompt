# LifeBridge — Emergency Triage & Crisis Response Assistant

A Gemini-powered web application that accepts **chaotic, real-world inputs across text, voice, structured feeds, and photos** and converts them into **structured, actionable emergency response plans**.

## Chosen Vertical

**Emergency Medical & Crisis Triage** — A universal bridge between human intent and complex emergency response systems. LifeBridge accepts any combination of disorganized text describing medical situations, natural disasters, or active emergencies and produces structured, prioritized action plans with severity levels, step-by-step instructions, risk factors, and emergency contacts.

## Approach and Logic

The current pipeline is multi-stage and multi-modal:

1. **Input normalization** — Accepts plain text plus structured JSON payloads (weather, traffic, medical records, news/social alerts, public-health reports, IoT sensor data, voice transcripts).
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

## Product Strength Narrative

This project is intentionally designed to deliver strong societal impact. The architecture, code quality posture, testing discipline, and user-flow decisions are all built to maximize real-world usefulness in time-sensitive emergency situations.

### 1) Problem Statement Alignment (Universal Bridge)

LifeBridge directly implements the required pattern: take noisy human or machine-originated input and convert it into structured, life-saving actions.

Why this is a strength:
- It accepts **messy text**, **voice transcripts**, **structured feeds** (traffic/weather/public-health/news/medical/IoT), and **photos**.
- It converts all pathways into one normalized triage flow, so users do not need a perfect input format.
- It produces a consistent output schema (severity, findings, action steps, warnings, contacts), which is practical for responders and non-experts.
- It includes context-aware enhancements (translation + location enrichment), increasing usefulness in multilingual, geographically diverse emergencies.

### 2) Societal Benefit and Real-World Utility

LifeBridge is focused on emergency response support where minutes matter and information is incomplete. It improves operational clarity for frontline scenarios.

Why this is a strength:
- Supports high-impact domains: medical triage, disaster response, active incidents, public health alerts, and infrastructure failures.
- Reduces cognitive overload by transforming narrative chaos into prioritized actions.
- Encourages safer decision-making through structured warnings and disclaimers.
- Supports inclusivity through multilingual input handling and optional voice output.

### 3) Code Quality and Maintainability

The codebase is organized for readability, predictable behavior, and long-term maintenance.

Why this is a strength:
- Strict TypeScript configuration (`strict`, unused checks, no implicit returns).
- Clear modular service boundaries (`inputNormalizer`, `inputProcessor`, `translation`, `locationEnricher`, `speechToText`, `textToSpeech`, `outputFormatter`).
- Deterministic, mostly pure processing functions that are easy to test and reason about.
- Lightweight dependency footprint and explicit quality scripts for repeatable local/CI checks.

### 4) Security Posture

Security choices are embedded as defaults rather than afterthoughts.

Why this is a strength:
- Input sanitization to reduce prompt-injection and XSS risk.
- Security headers for browser hardening (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, etc.).
- Request size limits and explicit payload-too-large handling.
- Per-IP rate limiting to reduce abuse and protect service availability.
- Safe fallback behavior when optional integrations fail.

### 5) Efficiency and Performance Resilience

The app favors responsiveness and graceful degradation in production-like constraints.

Why this is a strength:
- Timeout-wrapped enrichment steps (translation/location/STT/TTS) prevent tail-latency cascades.
- Non-critical features are optional, so core triage remains available even when enrichers degrade.
- Express setup is minimal and efficient with static asset caching.
- Pipeline structure avoids unnecessary heavyweight framework overhead.

### 6) Testing Discipline and Reliability

Tests are structured to balance confidence and developer velocity.

Why this is a strength:
- Multiple focused test suites across normalization, classification, formatting, location enrichment, translation, speech paths, and server behavior.
- Integration checks validate headers, API behavior, and error paths.
- Memory-oriented tests validate repeated-call stability.
- Tiered scripts (`test:fast`, `test:memory`, `test:full`, `quality:check`, `quality:full`) support both quick local loops and stricter release validation.

### 7) Accessibility and UX Robustness

The interface is intentionally simple, keyboard-friendly, and clarity-first.

Why this is a strength:
- Semantic structure and accessible labels in the UI.
- Scenario quick-selects for rapid onboarding.
- Visible error states, char counts, and structured result presentation.
- Voice input and optional voice output improve usability for users with different interaction needs.

### 8) Cloud and Service Integration Maturity

LifeBridge demonstrates practical, production-oriented integration patterns for cloud AI systems.

Why this is a strength:
- Uses Gemini for structured generation with safety settings.
- Integrates Google Translation, Maps context enrichment, Speech-to-Text, and Text-to-Speech in a cohesive pipeline.
- Deploys cleanly to Cloud Run with health checks and graceful shutdown handling.
- Keeps external-service dependencies optional where possible to preserve service continuity.

### Summary

The strongest story for this project is not just feature count, but **system behavior under messy real-world inputs**. LifeBridge consistently transforms ambiguity into actionable structure, while preserving safety, maintainability, and operational resilience.

## How the Solution Works

1. User visits the deployed Cloud Run URL
2. The interface presents a large text input area with sample scenario buttons
3. User can paste text, load a scenario (medical/disaster/emergency/traffic/weather/news/public-health/infrastructure), dictate speech, or attach a photo for visual triage
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

# Recommended free-tier-friendly chain (fallbacks kick in on 429/quota errors)
GEMINI_API_KEY=your_key_here \
GEMINI_MODEL=gemini-2.5-flash \
GEMINI_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-2.0-flash \
pnpm start
```

### Running Tests

```bash
pnpm run lint
pnpm test
pnpm run typecheck

# fast quality gate (default local loop)
pnpm run quality:check

# full quality gate (includes full test suite)
pnpm run quality:full
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
