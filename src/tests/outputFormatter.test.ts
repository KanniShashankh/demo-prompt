/**
 * @module outputFormatter.test
 * @description Comprehensive unit tests for the output formatting pipeline.
 *
 * Tests cover:
 *   - parseGeminiResponse: JSON parsing, markdown wrapper handling, error cases
 *   - validateOutput: required field checks, severity normalization, array defaults
 *   - formatActionPlan: end-to-end formatting with severity metadata
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGeminiResponse,
  validateOutput,
  formatActionPlan,
  SEVERITY_CONFIG,
  REQUIRED_FIELDS,
  DEFAULT_DISCLAIMER,
} from '../services/outputFormatter';

// ────────────────────────────────────────────────────────────────
// parseGeminiResponse
// ────────────────────────────────────────────────────────────────

describe('parseGeminiResponse', () => {
  it('should parse valid JSON string', () => {
    const raw = '{"severity": "CRITICAL", "title": "Test"}';
    const result = parseGeminiResponse(raw);
    assert.equal(result.severity, 'CRITICAL');
    assert.equal(result.title, 'Test');
  });

  it('should handle JSON wrapped in ```json code fences', () => {
    const raw = '```json\n{"severity": "URGENT", "title": "Wrapped"}\n```';
    const result = parseGeminiResponse(raw);
    assert.equal(result.severity, 'URGENT');
  });

  it('should handle JSON wrapped in ``` code fences (no language)', () => {
    const raw = '```\n{"severity": "LOW", "title": "Plain fence"}\n```';
    const result = parseGeminiResponse(raw);
    assert.equal(result.severity, 'LOW');
  });

  it('should throw for empty string', () => {
    assert.throws(() => parseGeminiResponse(''), /Empty or invalid/);
  });

  it('should throw for null input', () => {
    assert.throws(() => parseGeminiResponse(null as unknown as string), /Empty or invalid/);
  });

  it('should throw for invalid JSON', () => {
    assert.throws(() => parseGeminiResponse('not json at all'), /Failed to parse/);
  });

  it('should handle extra whitespace around valid JSON', () => {
    const raw = '   \n  {"severity": "MODERATE"}  \n  ';
    const result = parseGeminiResponse(raw);
    assert.equal(result.severity, 'MODERATE');
  });
});

// ────────────────────────────────────────────────────────────────
// validateOutput
// ────────────────────────────────────────────────────────────────

describe('validateOutput', () => {
  /** Helper: create a minimal valid action plan object. */
  function createValidPlan(overrides: Record<string, unknown> = {}) {
    return {
      severity: 'URGENT',
      title: 'Test Emergency',
      summary: 'A test situation for validation.',
      actionSteps: [{ priority: 1, action: 'Call 911', reasoning: 'Life at risk', timeframe: 'IMMEDIATE' }],
      ...overrides,
    };
  }

  it('should accept a valid action plan', () => {
    const result = validateOutput(createValidPlan());
    assert.equal(result.severity, 'URGENT');
    assert.equal(result.title, 'Test Emergency');
  });

  it('should throw for null input', () => {
    assert.throws(() => validateOutput(null), /Invalid action plan/);
  });

  it('should throw for non-object input', () => {
    assert.throws(() => validateOutput('string'), /Invalid action plan/);
  });

  it('should throw when required fields are missing', () => {
    assert.throws(() => validateOutput({ severity: 'LOW' }), /missing required fields/);
  });

  it('should normalize lowercase severity to uppercase', () => {
    const result = validateOutput(createValidPlan({ severity: 'critical' }));
    assert.equal(result.severity, 'CRITICAL');
  });

  it('should default unknown severity to MODERATE', () => {
    const result = validateOutput(createValidPlan({ severity: 'EXTREME' }));
    assert.equal(result.severity, 'MODERATE');
  });

  it('should default missing arrays to empty arrays', () => {
    const result = validateOutput(createValidPlan());
    assert.ok(Array.isArray(result.keyFindings));
    assert.ok(Array.isArray(result.warnings));
    assert.ok(Array.isArray(result.emergencyContacts));
    assert.equal(result.keyFindings.length, 0);
  });

  it('should sort action steps by priority (ascending)', () => {
    const result = validateOutput(createValidPlan({
      actionSteps: [
        { priority: 3, action: 'Third' },
        { priority: 1, action: 'First' },
        { priority: 2, action: 'Second' },
      ],
    }));
    assert.equal(result.actionSteps[0].action, 'First');
    assert.equal(result.actionSteps[1].action, 'Second');
    assert.equal(result.actionSteps[2].action, 'Third');
  });

  it('should add default disclaimer when missing', () => {
    const result = validateOutput(createValidPlan());
    assert.equal(result.disclaimer, DEFAULT_DISCLAIMER);
  });

  it('should preserve custom disclaimer when provided', () => {
    const custom = 'Custom disclaimer text';
    const result = validateOutput(createValidPlan({ disclaimer: custom }));
    assert.equal(result.disclaimer, custom);
  });

  it('should verify all required fields are tracked', () => {
    assert.ok(REQUIRED_FIELDS.includes('severity'));
    assert.ok(REQUIRED_FIELDS.includes('title'));
    assert.ok(REQUIRED_FIELDS.includes('summary'));
    assert.ok(REQUIRED_FIELDS.includes('actionSteps'));
  });
});

// ────────────────────────────────────────────────────────────────
// formatActionPlan
// ────────────────────────────────────────────────────────────────

describe('formatActionPlan', () => {
  function createValidPlan(overrides: Record<string, unknown> = {}) {
    return {
      severity: 'CRITICAL',
      title: 'Multi-vehicle accident',
      summary: 'Three-car collision with injuries.',
      actionSteps: [{ priority: 1, action: 'Call 911' }],
      ...overrides,
    };
  }

  it('should add severity metadata to the plan', () => {
    const result = formatActionPlan(createValidPlan());
    assert.ok(result.severityMeta);
    assert.equal(result.severityMeta.label, 'CRITICAL');
    assert.equal(result.severityMeta.icon, '🔴');
    assert.equal(result.severityMeta.color, '#ef4444');
  });

  it('should include formattedAt timestamp', () => {
    const result = formatActionPlan(createValidPlan());
    assert.ok(result.formattedAt);
    // Verify it's a valid ISO date
    assert.ok(!isNaN(Date.parse(result.formattedAt)));
  });

  it('should use MODERATE severity meta for unknown severity', () => {
    const result = formatActionPlan(createValidPlan({ severity: 'UNKNOWN' }));
    assert.equal(result.severityMeta.label, 'MODERATE');
    assert.equal(result.severityMeta.icon, '🔵');
  });

  it('should verify all severity configs have expected properties', () => {
    for (const [level, config] of Object.entries(SEVERITY_CONFIG)) {
      assert.ok(config.label, `${level} should have a label`);
      assert.ok(config.color, `${level} should have a color`);
      assert.ok(config.icon, `${level} should have an icon`);
      assert.ok(typeof config.priority === 'number', `${level} should have a priority`);
    }
  });

  it('should preserve all original plan data in the formatted output', () => {
    const original = createValidPlan({
      warnings: ['Fuel leak detected'],
      keyFindings: [{ category: 'Trauma', detail: 'Head injury', risk: 'HIGH' }],
    });
    const result = formatActionPlan(original);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0], 'Fuel leak detected');
    assert.equal(result.keyFindings[0].category, 'Trauma');
  });
});
