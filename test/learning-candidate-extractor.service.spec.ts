import { beforeEach, describe, expect, it } from 'vitest';

import { LearningCandidateExtractorService } from '../src/application/services/learning-candidate-extractor.service.js';
import type { ExtractLearningCandidatesInput } from '../src/application/services/learning-candidate-extractor.service.js';

describe('LearningCandidateExtractorService', () => {
  const service = new LearningCandidateExtractorService();

  beforeEach(() => {
    // no-op
  });

  const makeInput = (overrides: Partial<ExtractLearningCandidatesInput> = {}): ExtractLearningCandidatesInput => ({
    runId: overrides.runId ?? 'run-001',
    executionResult: overrides.executionResult ?? {},
    executionPlan: overrides.executionPlan ?? { planId: 'plan-001', goal: 'test' },
    selectedScenarios: overrides.selectedScenarios ?? {},
    memoryConsultationLog: overrides.memoryConsultationLog,
  });

  describe('locator telemetry', () => {
    it('extracts deterministic_resolution as semantic_locator with high confidence', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-001', type: 'deterministic_resolution', locatorStrategy: 'css', elementId: 'btn-login' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('semantic_locator');
      expect(candidates[0].source).toBe('confirmed');
      expect(candidates[0].confidence).toBe(0.9);
      expect(candidates[0].risk).toBe('low');
      expect(candidates[0].description).toContain('deterministically');
      expect(candidates[0].metadata?.locatorStrategy).toBe('css');
    });

    it('extracts semantic_fallback as semantic_locator with lower confidence', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-002', type: 'semantic_fallback', locatorStrategy: 'xpath', elementId: 'input-email' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('semantic_locator');
      expect(candidates[0].source).toBe('inferred');
      expect(candidates[0].confidence).toBe(0.6);
      expect(candidates[0].risk).toBe('medium');
      expect(candidates[0].description).toContain('semantic fallback');
    });

    it('skips ephemeral IDs (el_123)', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-001', type: 'deterministic_resolution', locatorStrategy: 'css', elementId: 'el_123' },
            { stepId: 'step-002', type: 'deterministic_resolution', locatorStrategy: 'css', elementId: 'btn-submit' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].metadata?.elementId).toBe('btn-submit');
    });

    it('skips ephemeral IDs with more digits (el_123456)', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-001', type: 'deterministic_resolution', elementId: 'el_123456' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(0);
    });

    it('allows non-ephemeral element IDs', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-001', type: 'deterministic_resolution', elementId: 'login-button' },
            { stepId: 'step-002', type: 'deterministic_resolution', elementId: 'el12' },
            { stepId: 'step-003', type: 'deterministic_resolution', elementId: 'submit_1' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(3);
    });

    it('extracts target_not_found as gap with high risk', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-003', type: 'target_not_found', locatorStrategy: 'css' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('gap');
      expect(candidates[0].risk).toBe('high');
      expect(candidates[0].confidence).toBe(0.5);
      expect(candidates[0].metadata?.memoryGap).toContain('missing_locator');
    });
  });

  describe('replan and llm_decide', () => {
    it('extracts replan as recovery_pattern', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-004', type: 'replan', locatorStrategy: 'css' },
          ],
        },
      });
      const candidates = service.extract(input);
      const replan = candidates.find((c) => c.type === 'recovery_pattern');
      expect(replan).toBeDefined();
      expect(replan?.description).toContain('replanned');
      expect(replan?.metadata?.hadReplan).toBe(true);
    });

    it('extracts llm_decide as component_behavior', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-005', type: 'llm_decide', locatorStrategy: 'semantic' },
          ],
        },
      });
      const candidates = service.extract(input);
      const decide = candidates.find((c) => c.type === 'component_behavior');
      expect(decide).toBeDefined();
      expect(decide?.description).toContain('LLM decision');
      expect(decide?.metadata?.hadDecide).toBe(true);
    });
  });

  describe('patch history', () => {
    it('extracts patch history as recovery_pattern', () => {
      const input = makeInput({
        executionResult: {
          patchHistory: [
            { stepId: 'step-006', reason: 'Timeout on first attempt' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('recovery_pattern');
      expect(candidates[0].description).toContain('patched');
      expect(candidates[0].content).toContain('Timeout on first attempt');
      expect(candidates[0].confidence).toBe(0.85);
    });

    it('uses unknown stepId when patch lacks stepId', () => {
      const input = makeInput({
        executionResult: {
          patchHistory: [
            { reason: 'Some patch' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates[0].stepId).toBe('unknown');
    });
  });

  describe('evaluation failures', () => {
    it('extracts ERROR evaluation failures as component_behavior', () => {
      const input = makeInput({
        executionResult: {
          evaluations: [
            {
              conditionId: 'cond-001',
              stepId: 'step-007',
              phase: 'post',
              type: 'assertion',
              passed: false,
              expected: 'success',
              actual: 'error',
              severity: 'ERROR',
              reason: 'Button not clickable',
            },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('component_behavior');
      expect(candidates[0].risk).toBe('high');
      expect(candidates[0].content).toContain('Button not clickable');
    });

    it('ignores passed evaluations', () => {
      const input = makeInput({
        executionResult: {
          evaluations: [
            { conditionId: 'cond-001', stepId: 'step-007', phase: 'post', type: 'assertion', passed: true, severity: 'ERROR', reason: 'ok' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(0);
    });

    it('ignores non-ERROR severity evaluations', () => {
      const input = makeInput({
        executionResult: {
          evaluations: [
            { conditionId: 'cond-001', stepId: 'step-007', phase: 'post', type: 'assertion', passed: false, severity: 'WARNING', reason: 'warn' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(0);
    });
  });

  describe('warnings', () => {
    it('extracts warnings as component_behavior', () => {
      const input = makeInput({
        executionResult: {
          warnings: [
            { stepId: 'step-008', message: 'Deprecated API usage detected in console' },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('component_behavior');
      expect(candidates[0].description).toContain('Deprecated API usage');
      expect(candidates[0].content).toBe('Deprecated API usage detected in console');
      expect(candidates[0].confidence).toBe(0.8);
    });

    it('truncates warning descriptions to 60 chars', () => {
      const longMessage = 'A'.repeat(100);
      const input = makeInput({
        executionResult: {
          warnings: [
            { stepId: 'step-009', message: longMessage },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates[0].description).toHaveLength(86); // "Warning during execution: " (26) + 60 chars
    });
  });

  describe('scenario expected outcomes', () => {
    it('extracts expected outcomes as semantic_locator', () => {
      const input = makeInput({
        selectedScenarios: {
          scenarios: [
            {
              id: 'scenario-001',
              title: 'Login',
              tasks: [
                {
                  id: 'task-001',
                  title: 'Enter credentials',
                  expected: 'Fields filled',
                  expectedOutcome: { kind: 'form_fill', description: 'Fill username and password', target: '#login-form' },
                },
              ],
            },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('semantic_locator');
      expect(candidates[0].scenarioId).toBe('scenario-001');
      expect(candidates[0].taskId).toBe('task-001');
      expect(candidates[0].metadata?.semanticKey).toBe('#login-form');
      expect(candidates[0].confidence).toBe(0.85);
    });

    it('ignores tasks without expectedOutcome', () => {
      const input = makeInput({
        selectedScenarios: {
          scenarios: [
            {
              id: 'scenario-001',
              title: 'Login',
              tasks: [
                { id: 'task-001', title: 'Click', expected: 'clicked' },
              ],
            },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(0);
    });
  });

  describe('memory gaps', () => {
    it('extracts unused memory consultation as gap', () => {
      const input = makeInput({
        memoryConsultationLog: {
          entries: [
            { query: 'login form locator', chunks: [], used: false },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('gap');
      expect(candidates[0].content).toContain('login form locator');
    });

    it('extracts empty chunk results as gap', () => {
      const input = makeInput({
        memoryConsultationLog: {
          entries: [
            { query: 'submit button', chunks: [], used: true },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('gap');
    });

    it('does not extract when memory was used with chunks', () => {
      const input = makeInput({
        memoryConsultationLog: {
          entries: [
            { query: 'home page', chunks: [{ id: 'chunk-1', type: 'route', title: 'Home' }], used: true },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(0);
    });
  });

  describe('plan fallback reason', () => {
    it('extracts fallback reason as recovery_pattern', () => {
      const input = makeInput({
        executionPlan: {
          planId: 'plan-001',
          goal: 'test',
          metadata: { fallbackReason: 'No scenarios correlated with PR diff' },
        },
      });
      const candidates = service.extract(input);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('recovery_pattern');
      expect(candidates[0].description).toContain('fallback');
      expect(candidates[0].content).toBe('No scenarios correlated with PR diff');
      expect(candidates[0].confidence).toBe(0.9);
    });

    it('does not extract when no fallback reason', () => {
      const input = makeInput({
        executionPlan: {
          planId: 'plan-001',
          goal: 'test',
          metadata: {},
        },
      });
      const candidates = service.extract(input);
      expect(candidates.filter((c) => c.type === 'recovery_pattern')).toHaveLength(0);
    });
  });

  describe('findScenarioForStep', () => {
    it('maps step to scenario via executionPlan', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-010', type: 'deterministic_resolution', elementId: 'btn' },
          ],
        },
        executionPlan: {
          planId: 'plan-001',
          goal: 'test',
          steps: [
            { id: 'step-010', scenarioId: 'scenario-010', description: 'Click button', action: {} },
          ],
        },
      });
      const candidates = service.extract(input);
      expect(candidates[0].scenarioId).toBe('scenario-010');
    });

    it('returns undefined when step not found in plan', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-missing', type: 'deterministic_resolution', elementId: 'btn' },
          ],
        },
        executionPlan: { planId: 'plan-001', goal: 'test', steps: [] },
      });
      const candidates = service.extract(input);
      expect(candidates[0].scenarioId).toBeUndefined();
    });
  });

  describe('multiple sources combined', () => {
    it('extracts candidates from all sources in one call', () => {
      const input = makeInput({
        executionResult: {
          locatorTelemetry: [
            { stepId: 'step-001', type: 'deterministic_resolution', elementId: 'btn' },
            { stepId: 'step-002', type: 'replan' },
          ],
          patchHistory: [{ stepId: 'step-003', reason: 'Retry' }],
          evaluations: [
            { conditionId: 'c1', stepId: 'step-004', phase: 'post', type: 'assertion', passed: false, expected: 'ok', actual: 'fail', severity: 'ERROR', reason: 'fail' },
          ],
          warnings: [{ stepId: 'step-005', message: 'Warning' }],
        },
        selectedScenarios: {
          scenarios: [
            {
              id: 'sc-001',
              title: 'T',
              tasks: [
                { id: 't1', title: 'T', expected: 'ok', expectedOutcome: { kind: 'navigate', description: 'Go home', target: '/' } },
              ],
            },
          ],
        },
        memoryConsultationLog: {
          entries: [{ query: 'q1', chunks: [], used: false }],
        },
        executionPlan: {
          planId: 'plan-001',
          goal: 'test',
          metadata: { fallbackReason: 'fallback' },
        },
      });
      const candidates = service.extract(input);
      expect(candidates.length).toBeGreaterThanOrEqual(8);
      expect(candidates.some((c) => c.type === 'semantic_locator')).toBe(true);
      expect(candidates.some((c) => c.type === 'recovery_pattern')).toBe(true);
      expect(candidates.some((c) => c.type === 'component_behavior')).toBe(true);
      expect(candidates.some((c) => c.type === 'gap')).toBe(true);
    });
  });
});
