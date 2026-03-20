# AGENTS.md — Project Positives Playbook

This guide helps contributors and coding agents preserve and communicate the strongest parts of LifeBridge during implementation, review, and release notes.

## Purpose

LifeBridge is evaluated on practical impact, reliability, safety, and engineering quality. This document captures how to describe and protect the project’s strongest dimensions.

## Positive Positioning

When describing the project, emphasize that LifeBridge is:

- A **universal bridge** from messy real-world input to structured, actionable emergency guidance.
- A **multi-modal pipeline** that handles text, structured feeds, voice, and image pathways.
- A **resilient, safety-aware system** designed for imperfect, time-critical situations.
- A **maintainable engineering implementation** with strong typing, modular services, and repeatable quality checks.

## Strengths by Dimension

### 1. Problem Statement Alignment

Core claim:
- LifeBridge directly maps to the challenge requirement: take unstructured/chaotic inputs and transform them into verified, structured, life-saving actions.

Evidence patterns to cite:
- Input normalization for traffic/weather/news/public-health/medical/IoT/voice-transcript JSON payloads.
- Scenario-based UX plus free-form input for real-world chaos.
- Unified output format with severity, findings, action steps, warnings, and contacts.

### 2. Societal Benefit

Core claim:
- The app supports high-impact emergency workflows where users need immediate clarity from incomplete information.

Evidence patterns to cite:
- Medical + disaster + emergency + public-health + infrastructure pathways.
- Translation and location enrichment for broader reach and local relevance.
- Action-oriented outputs with risk and warning handling.

### 3. Code Quality

Core claim:
- The codebase favors maintainability, readability, and deterministic behavior.

Evidence patterns to cite:
- Strict TypeScript and explicit compiler constraints.
- Service-oriented separation of concerns.
- Predictable transformations and testable modules.
- Lean dependency model.

### 4. Security

Core claim:
- Security controls are integrated into default behavior.

Evidence patterns to cite:
- Input sanitization and output safety posture.
- Rate limiting and request payload controls.
- Security headers and robust error handling.
- Fail-safe fallback paths for non-critical enrichments.

### 5. Efficiency and Reliability

Core claim:
- The pipeline is designed to remain responsive even when external services are slow or unavailable.

Evidence patterns to cite:
- Timeouts around optional enrichments.
- Graceful degradation while preserving core triage.
- Minimal runtime overhead and clean production setup.

### 6. Testing Quality

Core claim:
- The project includes broad, practical test coverage with developer-friendly execution tiers.

Evidence patterns to cite:
- Unit + integration + memory-focused suites.
- Fast and full test pathways.
- Quality scripts combining lint, typecheck, and tests.

### 7. Accessibility and Usability

Core claim:
- UX design prioritizes clarity and broad accessibility under stress conditions.

Evidence patterns to cite:
- Semantic UI structure and assistive labels.
- Voice input and optional speech output.
- Clear error messaging and structured results.

### 8. Cloud/Google Services Integration

Core claim:
- Integrations are practical and cohesive, not superficial.

Evidence patterns to cite:
- Gemini core triage generation.
- Translation, Maps enrichment, STT, and TTS integration points.
- Cloud Run deployment readiness and health checks.

## Contributor Rules for Product Strength

When adding or modifying code:

1. Preserve multi-modal support; do not narrow accepted input types.
2. Keep output schema structured and action-oriented.
3. Maintain security defaults (sanitization, limits, headers, safe errors).
4. Add or update tests when classification/normalization/output logic changes.
5. Keep quality scripts green before release (lint + typecheck at minimum).
6. Document meaningful behavior changes in README.
7. Prefer robust fallback behavior over hard failures for optional cloud features.

## Release Note Language Bank

Use these phrasing patterns in release notes:

- "Improved universal-input coverage by strengthening normalization and classification for messy real-world feeds."
- "Increased triage reliability with stronger safety defaults and better fallback handling."
- "Expanded quality assurance through stricter lint/type gates and layered test execution options."
- "Enhanced societal-impact alignment by improving response quality for emergency and public-safety scenarios."

## Anti-Patterns to Avoid

Avoid these because they weaken product impact and clarity:

- Overfitting the app to one narrow input style.
- Returning unstructured model text without action schema enforcement.
- Introducing features that bypass sanitization/security middleware.
- Shipping changes that reduce test coverage or break fast quality checks.
- Inflating claims in docs without code-level evidence.

## Quick Self-Review Checklist

Before merge or deployment, verify:

- [ ] Multi-modal input handling still works (text + structured + voice + image paths as applicable).
- [ ] Output remains structured and actionable.
- [ ] Security and request limits are still enforced.
- [ ] Lint and typecheck pass.
- [ ] Relevant tests were updated.
- [ ] README and release notes reflect meaningful, evidence-backed improvements.

This file should evolve as product expectations change, while preserving clear, evidence-based messaging about the system’s strengths.
