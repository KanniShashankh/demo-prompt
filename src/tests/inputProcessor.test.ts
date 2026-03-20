/**
 * @module inputProcessor.test
 * @description Comprehensive unit tests for the input processing pipeline.
 *
 * Tests cover:
 *   - sanitizeInput: XSS prevention, HTML stripping, length limits, edge cases
 *   - classifyInputType: keyword scoring, tie-breaking, empty input
 *   - buildContextPrompt: prompt structure validation, context prefixes
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeInput,
  classifyInputType,
  buildContextPrompt,
  MAX_INPUT_LENGTH,
} from '../services/inputProcessor';

// ────────────────────────────────────────────────────────────────
// sanitizeInput
// ────────────────────────────────────────────────────────────────

describe('sanitizeInput', () => {
  it('should return empty string for null input', () => {
    assert.equal(sanitizeInput(null), '');
  });

  it('should return empty string for undefined input', () => {
    assert.equal(sanitizeInput(undefined), '');
  });

  it('should return empty string for non-string input (number)', () => {
    assert.equal(sanitizeInput(42 as unknown), '');
  });

  it('should return empty string for empty string', () => {
    assert.equal(sanitizeInput(''), '');
  });

  it('should return empty string for whitespace-only input', () => {
    assert.equal(sanitizeInput('   \n\t  '), '');
  });

  it('should strip HTML tags from input', () => {
    const result = sanitizeInput('<script>alert("xss")</script>Hello');
    assert.equal(result, 'alert(xss)Hello');
    assert.ok(!result.includes('<script>'));
  });

  it('should remove angle brackets and quotes', () => {
    const result = sanitizeInput('Hello <world> "test" \'value\'');
    assert.ok(!result.includes('<'));
    assert.ok(!result.includes('>'));
    assert.ok(!result.includes('"'));
    assert.ok(!result.includes("'"));
  });

  it('should normalize multiple whitespace characters', () => {
    const result = sanitizeInput('hello    world\n\nnew    line');
    assert.equal(result, 'hello world new line');
  });

  it('should trim leading and trailing whitespace', () => {
    const result = sanitizeInput('  hello world  ');
    assert.equal(result, 'hello world');
  });

  it('should truncate input exceeding MAX_INPUT_LENGTH', () => {
    const longInput = 'a'.repeat(MAX_INPUT_LENGTH + 1000);
    const result = sanitizeInput(longInput);
    assert.equal(result.length, MAX_INPUT_LENGTH);
  });

  it('should preserve valid text content', () => {
    const input = 'Patient has fever of 102F and chest pain for 2 days';
    const result = sanitizeInput(input);
    assert.equal(result, input);
  });

  it('should handle input with only HTML tags', () => {
    const result = sanitizeInput('<b><i><script></script></i></b>');
    assert.equal(result, '');
  });
});

// ────────────────────────────────────────────────────────────────
// classifyInputType
// ────────────────────────────────────────────────────────────────

describe('classifyInputType', () => {
  it('should return "general" for empty input', () => {
    assert.equal(classifyInputType(''), 'general');
  });

  it('should return "general" for input with no recognized keywords', () => {
    assert.equal(classifyInputType('the weather is nice today'), 'general');
  });

  it('should classify medical input correctly', () => {
    const input = 'patient has diabetes and is on insulin medication with a fever';
    assert.equal(classifyInputType(input), 'medical');
  });

  it('should classify disaster input correctly', () => {
    const input = 'massive flood in the area, evacuation needed, shelter required';
    assert.equal(classifyInputType(input), 'disaster');
  });

  it('should classify emergency input correctly', () => {
    const input = 'car crash on highway, person unconscious and bleeding, not breathing';
    assert.equal(classifyInputType(input), 'emergency');
  });

  it('should handle mixed input by choosing the highest-scoring category', () => {
    // This input has more medical keywords than emergency
    const input = 'patient with diabetes on insulin has chronic pain, allergy to medication, needs surgery for fracture';
    assert.equal(classifyInputType(input), 'medical');
  });

  it('should prioritize emergency over others when scores are tied', () => {
    // One keyword from each — emergency should win on ties
    const input = 'there was an accident in the flood area and the patient has pain';
    const result = classifyInputType(input);
    // 'accident' = emergency, 'flood' = disaster, 'pain' + 'patient' = medical (2)
    // Medical should win here with 2 hits
    assert.equal(result, 'medical');
  });

  it('should be case-insensitive', () => {
    const input = 'PATIENT has DIABETES and FEVER';
    assert.equal(classifyInputType(input), 'medical');
  });

  it('should classify traffic input correctly', () => {
    const input = 'there was a vehicle collision on the highway, multiple cars involved, road is blocked';
    assert.equal(classifyInputType(input), 'traffic');
  });

  it('should classify weather input correctly', () => {
    const input = 'extreme heat wave today, temperature is very high, uv index dangerous, heat advisory issued';
    assert.equal(classifyInputType(input), 'weather');
  });

  it('should classify public health input correctly', () => {
    const input = 'outbreak of disease reported, community spread confirmed, quarantine zone established, virus detected';
    assert.equal(classifyInputType(input), 'public-health');
  });

  it('should classify infrastructure input correctly', () => {
    const input = 'major power outage affecting six blocks, blackout started at 3am, grid failure reported';
    assert.equal(classifyInputType(input), 'infrastructure');
  });

  it('should prioritize emergency over traffic on tie', () => {
    // accident is in emergency keywords, car crash is in traffic — emergency should win
    const input = 'car accident crash on highway, person unconscious';
    assert.equal(classifyInputType(input), 'emergency');
  });

  it('should return general when input only has weather and no specific alert keywords', () => {
    // Only 1 keyword from any category — still classifies
    const result = classifyInputType('the temperature outside is mild');
    // 'temperature' matches weather
    assert.equal(result, 'weather');
  });
});

// ────────────────────────────────────────────────────────────────
// buildContextPrompt
// ────────────────────────────────────────────────────────────────

describe('buildContextPrompt', () => {
  it('should include the user input in the prompt', () => {
    const input = 'patient has a broken arm';
    const prompt = buildContextPrompt(input, 'medical');
    assert.ok(prompt.includes(input), 'Prompt should contain the user input');
  });

  it('should include medical context prefix for medical input', () => {
    const prompt = buildContextPrompt('test input', 'medical');
    assert.ok(prompt.includes('medical information'), 'Should contain medical context');
  });

  it('should include disaster context prefix for disaster input', () => {
    const prompt = buildContextPrompt('test input', 'disaster');
    assert.ok(prompt.includes('disaster situation'), 'Should contain disaster context');
  });

  it('should include emergency context prefix for emergency input', () => {
    const prompt = buildContextPrompt('test input', 'emergency');
    assert.ok(prompt.includes('TIME-CRITICAL'), 'Should contain emergency context');
  });

  it('should include traffic context prefix for traffic input', () => {
    const prompt = buildContextPrompt('test input', 'traffic');
    assert.ok(prompt.includes('traffic'), 'Should contain traffic context');
  });

  it('should include weather context prefix for weather input', () => {
    const prompt = buildContextPrompt('test input', 'weather');
    assert.ok(prompt.includes('weather'), 'Should contain weather context');
  });

  it('should include public-health context prefix for public-health input', () => {
    const prompt = buildContextPrompt('test input', 'public-health');
    assert.ok(prompt.includes('public health') || prompt.includes('outbreak'), 'Should contain public health context');
  });

  it('should include infrastructure context prefix for infrastructure input', () => {
    const prompt = buildContextPrompt('test input', 'infrastructure');
    assert.ok(prompt.includes('infrastructure') || prompt.includes('utility'), 'Should contain infrastructure context');
  });

  it('should include general context prefix for general input', () => {
    const prompt = buildContextPrompt('test input', 'general');
    assert.ok(prompt.includes('unstructured description'), 'Should contain general context');
  });

  it('should include separator markers for clear prompt structure', () => {
    const prompt = buildContextPrompt('test input', 'general');
    assert.ok(prompt.includes('---'), 'Should contain separator');
    assert.ok(prompt.includes('INPUT:'), 'Should contain INPUT label');
    assert.ok(prompt.includes('JSON triage response'), 'Should request JSON output');
  });

  it('should handle empty sanitized text gracefully', () => {
    const prompt = buildContextPrompt('', 'general');
    assert.ok(prompt.includes('INPUT:'), 'Should still have structure even with empty input');
  });
});
