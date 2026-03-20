import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseTriageJsonResponse } from '../services/gemini';

describe('parseTriageJsonResponse', () => {
  it('parses raw JSON object', () => {
    const raw = '{"severity":"CRITICAL","title":"A","summary":"B","actionSteps":[]}';
    const parsed = parseTriageJsonResponse(raw);

    assert.equal(parsed.severity, 'CRITICAL');
    assert.equal(parsed.title, 'A');
  });

  it('parses markdown fenced JSON', () => {
    const raw = '```json\n{"severity":"URGENT","title":"A","summary":"B","actionSteps":[]}\n```';
    const parsed = parseTriageJsonResponse(raw);

    assert.equal(parsed.severity, 'URGENT');
  });

  it('parses prose plus embedded JSON', () => {
    const raw = 'Here is the response:\n{"severity":"MODERATE","title":"A","summary":"B","actionSteps":[]}\nUse with caution.';
    const parsed = parseTriageJsonResponse(raw);

    assert.equal(parsed.severity, 'MODERATE');
  });

  it('prefers action-plan-like object when multiple objects exist', () => {
    const raw = 'meta: {"foo":"bar"} result: {"severity":"LOW","title":"A","summary":"B","actionSteps":[]}';
    const parsed = parseTriageJsonResponse(raw);

    assert.equal(parsed.severity, 'LOW');
    assert.equal(parsed.title, 'A');
  });

  it('throws for empty input', () => {
    assert.throws(() => parseTriageJsonResponse('   '), /Empty model response/);
  });

  it('throws when no JSON object is present', () => {
    assert.throws(() => parseTriageJsonResponse('no structured payload present'), /No JSON object found/);
  });

  it('parses top-level JSON array containing an action plan object', () => {
    const raw = '[{"severity":"URGENT","title":"Flood","summary":"Severe flood event","actionSteps":[]}]';
    const parsed = parseTriageJsonResponse(raw);

    assert.equal(parsed.severity, 'URGENT');
    assert.equal(parsed.title, 'Flood');
  });

  it('parses prose-wrapped JSON array payload', () => {
    const raw = 'Structured result:\n[{"severity":"CRITICAL","title":"Bridge risk","summary":"Potential collapse","actionSteps":[]}]\nEnd.';
    const parsed = parseTriageJsonResponse(raw);

    assert.equal(parsed.severity, 'CRITICAL');
  });
});
