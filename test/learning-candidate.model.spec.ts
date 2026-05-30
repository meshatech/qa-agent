import { describe, expect, it } from 'vitest';

import type {
  LocatorLearning,
  FlowLearning,
  KnownIssueLearning,
  ScenarioResultLearning,
  LearningCandidate,
  LearningType,
} from '../src/domain/models/learning-candidate.model.js';

describe('LearningCandidate model', () => {
  it('defines all four learning types', () => {
    const types: LearningType[] = ['locator', 'flow', 'known_issue', 'scenario_result'];
    expect(types).toHaveLength(4);
    expect(new Set(types)).toEqual(new Set(['locator', 'flow', 'known_issue', 'scenario_result']));
  });

  it('accepts a LocatorLearning with required fields', () => {
    const learning: LocatorLearning = {
      type: 'locator',
      title: 'Login button resolved',
      description: 'Button with text "Entrar" resolves correctly',
      sourceRunId: 'run-001',
      confidence: 0.92,
      createdAt: '2024-05-29T10:00:00Z',
      locator: { strategy: 'text_any', texts: ['Entrar', 'Login'] },
      succeeded: true,
    };
    expect(learning.type).toBe('locator');
    expect(learning.succeeded).toBe(true);
    expect(learning.locator.strategy).toBe('text_any');
  });

  it('accepts a FlowLearning with steps', () => {
    const learning: FlowLearning = {
      type: 'flow',
      title: 'Login flow',
      description: 'Step-by-step login flow',
      sourceRunId: 'run-002',
      confidence: 0.85,
      createdAt: '2024-05-29T11:00:00Z',
      steps: [
        { order: 1, action: 'fill', target: 'email field', expectedOutcome: 'email entered' },
        { order: 2, action: 'fill', target: 'password field', expectedOutcome: 'password entered' },
        { order: 3, action: 'click', target: 'login button', expectedOutcome: 'authenticated' },
      ],
      entryPoint: '/login',
      exitPoint: '/dashboard',
    };
    expect(learning.steps).toHaveLength(3);
    expect(learning.entryPoint).toBe('/login');
  });

  it('accepts a KnownIssueLearning with severity', () => {
    const learning: KnownIssueLearning = {
      type: 'known_issue',
      title: 'Intermittent login failure',
      description: 'Login fails when session cookie is stale',
      sourceRunId: 'run-003',
      confidence: 0.75,
      createdAt: '2024-05-29T12:00:00Z',
      symptom: 'Authentication error after credentials entered',
      cause: 'Expired session cookie not cleared before login',
      workaround: 'Clear cookies before login attempt',
      affectedRoutes: ['/login', '/auth'],
      severity: 'high',
    };
    expect(learning.severity).toBe('high');
    expect(learning.affectedRoutes).toContain('/login');
  });

  it('accepts a ScenarioResultLearning with assertions', () => {
    const learning: ScenarioResultLearning = {
      type: 'scenario_result',
      title: 'Dashboard navigation scenario',
      description: 'Navigation to dashboard passed all assertions',
      sourceRunId: 'run-004',
      confidence: 1.0,
      createdAt: '2024-05-29T13:00:00Z',
      scenarioId: 'scenario-001',
      passed: true,
      retryable: false,
      assertions: [
        { name: 'url_matches', passed: true, expected: '/dashboard', actual: '/dashboard' },
        { name: 'no_console_errors', passed: true },
      ],
    };
    expect(learning.passed).toBe(true);
    expect(learning.assertions).toHaveLength(2);
  });

  it('allows union assignment of all variants', () => {
    const candidates: LearningCandidate[] = [
      {
        type: 'locator',
        title: 'Locator test',
        description: 'Test',
        sourceRunId: 'run-001',
        confidence: 0.5,
        createdAt: '2024-01-01T00:00:00Z',
        locator: { strategy: 'role', role: 'button' },
        succeeded: false,
      },
      {
        type: 'flow',
        title: 'Flow test',
        description: 'Test',
        sourceRunId: 'run-001',
        confidence: 0.5,
        createdAt: '2024-01-01T00:00:00Z',
        steps: [],
      },
      {
        type: 'known_issue',
        title: 'Issue test',
        description: 'Test',
        sourceRunId: 'run-001',
        confidence: 0.5,
        createdAt: '2024-01-01T00:00:00Z',
        symptom: 'Symptom',
        severity: 'low',
      },
      {
        type: 'scenario_result',
        title: 'Result test',
        description: 'Test',
        sourceRunId: 'run-001',
        confidence: 0.5,
        createdAt: '2024-01-01T00:00:00Z',
        scenarioId: 'scenario-001',
        passed: false,
        retryable: true,
        assertions: [],
      },
    ];
    expect(candidates).toHaveLength(4);
  });
});
