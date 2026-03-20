# LifeBridge — Emergency Triage & Crisis Response Assistant

A Gemini-powered web application that takes **unstructured, chaotic, real-world inputs** — messy medical notes, frantic emergency descriptions, disaster situation reports — and instantly converts them into **structured, verified, life-saving action plans**.

## Chosen Vertical

**Emergency Medical & Crisis Triage** — A universal bridge between human intent and complex emergency response systems. LifeBridge accepts any combination of disorganized text describing medical situations, natural disasters, or active emergencies and produces structured, prioritized action plans with severity levels, step-by-step instructions, risk factors, and emergency contacts.

## Approach and Logic

The system uses a three-stage processing pipeline:

1. **Input Processing** — Raw text is sanitized (XSS prevention, HTML stripping, length enforcement), then classified into one of four categories (medical, disaster, emergency, general) using a keyword-frequency scoring model.

2. **Contextual Prompting** — Based on the classification, a context-specific prompt is constructed that guides Google Gemini to focus on the most relevant details (e.g., drug interactions for medical, infrastructure damage for disasters).

3. **Structured Output** — Gemini responds with structured JSON conforming to a strict schema. The response is validated, severity metadata is attached, action steps are priority-sorted, and a mandatory safety disclaimer is added.

### Key Design Decisions

- **TypeScript** with strict mode for type safety and maintainability
- **Zero frontend frameworks** — vanilla HTML/CSS/JS for minimal footprint
- **Only 2 production dependencies** — `express` and `@google/generative-ai`
- **Node.js built-in test runner** (`node --test`) — zero test framework overhead
- **Input sanitization** to guard against prompt injection and XSS
- **Safety settings** on all Gemini harm categories (BLOCK_MEDIUM_AND_ABOVE)
- **Rate limiting** to prevent API abuse
- **Memory-bounded telemetry** for operational monitoring

## How the Solution Works

1. User visits the deployed Cloud Run URL
2. The interface presents a large text input area with sample scenario buttons
3. User pastes or types chaotic, unstructured text (e.g., medical notes, emergency descriptions)
4. The frontend sends the text to `POST /api/triage`
5. Server pipeline: sanitize → classify → prompt → Gemini → validate → format
6. A structured action plan card is rendered with severity level, findings, steps, warnings, and contacts

### Running Locally

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server (requires GEMINI_API_KEY env var)
GEMINI_API_KEY=your_key_here npm start

# Optional: override model (default is gemini-2.5-flash)
GEMINI_API_KEY=your_key_here GEMINI_MODEL=gemini-2.5-flash npm start

# Visit http://localhost:8080
```

### Running Tests

```bash
npm test
```

Tests include:
- **Unit tests** for input sanitization, classification, and output formatting
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
- **Deployment:** Google Cloud Run (Docker)
- **Testing:** Node.js built-in test runner (`node:test`)

## Project Structure

```
lifebridge/
├── src/
│   ├── server.ts                 # Express app entry point
│   ├── services/
│   │   ├── gemini.ts             # Gemini API client with safety settings
│   │   ├── inputProcessor.ts     # Sanitize, classify, build prompts
│   │   ├── outputFormatter.ts    # Parse, validate, format action plans
│   │   └── telemetry.ts          # Request monitoring middleware
│   └── tests/
│       ├── inputProcessor.test.ts
│       ├── outputFormatter.test.ts
│       ├── server.test.ts
│       └── memory.test.ts
├── public/
│   ├── index.html                # Accessible, semantic frontend
│   ├── styles.css                # Premium dark theme
│   └── app.js                    # Client-side logic
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```
