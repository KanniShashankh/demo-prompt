/**
 * @module memory.test
 * @description Memory and resource management tests for LifeBridge.
 *
 * Validates that:
 *   - Input processing doesn't leak memory on repeated calls
 *   - Output formatting cleans up properly
 *   - Large input handling stays within expected memory bounds
 *   - Repeated sanitization doesn't accumulate garbage
 *
 * These tests use process.memoryUsage() to track heap usage
 * across many iterations and assert that growth stays bounded.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeInput, classifyInputType, buildContextPrompt } from '../services/inputProcessor';
import { parseGeminiResponse, validateOutput, formatActionPlan } from '../services/outputFormatter';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Force garbage collection if available (run with --expose-gc). */
function tryGC(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

/** Get current heap usage in MB. */
function heapMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

/**
 * Measure memory growth over many iterations of a function.
 * Returns the delta in MB between start and end heap usage.
 */
function measureMemoryGrowth(iterations: number, fn: () => void): number {
  tryGC();
  const startHeap = heapMB();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  tryGC();
  const endHeap = heapMB();

  return endHeap - startHeap;
}

// ────────────────────────────────────────────────────────────────
// sanitizeInput memory tests
// ────────────────────────────────────────────────────────────────

describe('Memory: sanitizeInput', () => {
  it('should not leak memory over 10,000 sanitization calls', () => {
    const testInput = '<script>alert("xss")</script>' + 'a'.repeat(1000);
    const growth = measureMemoryGrowth(10_000, () => {
      sanitizeInput(testInput);
    });

    // Allow up to 10MB growth (generous threshold for test environments)
    assert.ok(growth < 10, `Memory grew by ${growth.toFixed(2)}MB — possible leak`);
  });

  it('should handle repeated large input sanitization without excessive memory use', () => {
    const largeInput = 'x'.repeat(5000);
    const growth = measureMemoryGrowth(5_000, () => {
      sanitizeInput(largeInput);
    });

    assert.ok(growth < 15, `Memory grew by ${growth.toFixed(2)}MB on large inputs`);
  });
});

// ────────────────────────────────────────────────────────────────
// classifyInputType memory tests
// ────────────────────────────────────────────────────────────────

describe('Memory: classifyInputType', () => {
  it('should not leak memory over 10,000 classification calls', () => {
    const testInput = 'patient has diabetes and fever with bleeding from accident in flood area';
    const growth = measureMemoryGrowth(10_000, () => {
      classifyInputType(testInput);
    });

    assert.ok(growth < 10, `Memory grew by ${growth.toFixed(2)}MB — possible leak`);
  });
});

// ────────────────────────────────────────────────────────────────
// buildContextPrompt memory tests
// ────────────────────────────────────────────────────────────────

describe('Memory: buildContextPrompt', () => {
  it('should not leak memory over 10,000 prompt construction calls', () => {
    const testInput = 'patient with severe chest pain and difficulty breathing';
    const growth = measureMemoryGrowth(10_000, () => {
      buildContextPrompt(testInput, 'medical');
    });

    assert.ok(growth < 10, `Memory grew by ${growth.toFixed(2)}MB — possible leak`);
  });
});

// ────────────────────────────────────────────────────────────────
// parseGeminiResponse memory tests
// ────────────────────────────────────────────────────────────────

describe('Memory: parseGeminiResponse', () => {
  it('should not leak memory over 10,000 JSON parsing calls', () => {
    const response = JSON.stringify({
      severity: 'CRITICAL',
      title: 'Test',
      summary: 'A test.',
      actionSteps: [{ priority: 1, action: 'Test action', reasoning: 'Test', timeframe: 'IMMEDIATE' }],
      keyFindings: [{ category: 'Test', detail: 'Detail', risk: 'HIGH' }],
      warnings: ['Warning 1'],
      emergencyContacts: [{ name: 'Fire', number: '911', when: 'Immediately' }],
      disclaimer: 'Test disclaimer.',
    });

    const growth = measureMemoryGrowth(10_000, () => {
      parseGeminiResponse(response);
    });

    assert.ok(growth < 10, `Memory grew by ${growth.toFixed(2)}MB — possible leak`);
  });

  it('should handle repeated parsing of code-fenced responses', () => {
    const response = '```json\n{"severity":"LOW","title":"T","summary":"S","actionSteps":[]}\n```';

    const growth = measureMemoryGrowth(5_000, () => {
      parseGeminiResponse(response);
    });

    assert.ok(growth < 10, `Memory grew by ${growth.toFixed(2)}MB`);
  });
});

// ────────────────────────────────────────────────────────────────
// Full pipeline memory tests
// ────────────────────────────────────────────────────────────────

describe('Memory: full processing pipeline', () => {
  it('should not leak memory when running the complete pipeline 5,000 times', () => {
    const rawInput = '<b>Patient</b> 67yo diabetic on insulin, fell down, bleeding, chest pain for 2 days';
    const mockGeminiOutput = {
      severity: 'CRITICAL',
      title: 'Elderly Diabetic Fall with Cardiac Symptoms',
      summary: 'High-risk situation involving head trauma and potential cardiac event.',
      actionSteps: [
        { priority: 1, action: 'Call 911', reasoning: 'Active cardiac symptoms', timeframe: 'IMMEDIATE' },
        { priority: 2, action: 'Apply pressure to wound', reasoning: 'Head laceration', timeframe: 'IMMEDIATE' },
      ],
      keyFindings: [
        { category: 'Cardiac', detail: 'Chest pain for 2 days', risk: 'HIGH' },
        { category: 'Trauma', detail: 'Head injury from fall', risk: 'HIGH' },
      ],
      warnings: ['Patient is on blood thinners'],
      emergencyContacts: [{ name: 'Emergency', number: '911', when: 'Immediately' }],
      disclaimer: 'Consult a professional.',
    };

    const growth = measureMemoryGrowth(5_000, () => {
      // Step 1: Sanitize
      const sanitized = sanitizeInput(rawInput);
      // Step 2: Classify
      const inputType = classifyInputType(sanitized);
      // Step 3: Build prompt
      buildContextPrompt(sanitized, inputType);
      // Step 4: Format output (simulating Gemini response)
      formatActionPlan(mockGeminiOutput);
    });

    assert.ok(growth < 20, `Full pipeline memory grew by ${growth.toFixed(2)}MB — possible leak`);
  });
});

// ────────────────────────────────────────────────────────────────
// validateOutput memory tests
// ────────────────────────────────────────────────────────────────

describe('Memory: validateOutput edge cases', () => {
  it('should handle repeated validation of plans with missing optional fields', () => {
    const minimalPlan = {
      severity: 'LOW',
      title: 'Minor issue',
      summary: 'Nothing serious.',
      actionSteps: [{ priority: 1, action: 'Monitor' }],
    };

    const growth = measureMemoryGrowth(10_000, () => {
      validateOutput(minimalPlan);
    });

    assert.ok(growth < 10, `Memory grew by ${growth.toFixed(2)}MB`);
  });

  it('should handle repeated error cases without leaking', () => {
    const growth = measureMemoryGrowth(10_000, () => {
      try {
        validateOutput(null);
      } catch {
        // Expected to throw
      }
    });

    assert.ok(growth < 5, `Error path memory grew by ${growth.toFixed(2)}MB`);
  });
});
