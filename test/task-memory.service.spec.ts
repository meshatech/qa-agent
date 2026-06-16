import { describe, expect, it, beforeEach } from 'vitest';
import { TaskMemoryService } from '../src/application/services/task-memory.service.js';

describe('TaskMemoryService', () => {
  let service: TaskMemoryService;

  beforeEach(() => {
    service = new TaskMemoryService();
  });

  it('ensures and returns working memory', () => {
    const item = service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    expect(item.scenarioId).toBe('S1');
    expect(item.taskId).toBe('T1');
    expect(item.state).toBe('PLANNING');
    expect(item.actionsTried).toEqual([]);
  });

  it('returns existing item on duplicate ensure', () => {
    const first = service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    const second = service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Different', expected: 'Different' });
    expect(second).toBe(first);
  });

  it('records observation', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    service.observe('S1', 'T1', {
      observationId: 'obs_1',
      createdAt: new Date().toISOString(),
      url: 'https://app.local/',
      title: 'App',
      visibleTexts: ['Dashboard'],
      elements: [],
      pageState: { isLoading: false, hasModal: false, hasToast: false, hasValidationErrors: false },
      consoleSignals: [],
      networkSignals: [],
      meta: { viewport: { width: 1280, height: 720 }, schemaVersion: 'obs.v1' },
    });
    const ctx = service.context('S1', 'T1');
    expect(ctx).toContain('Observed:');
    expect(ctx).toContain('Dashboard');
  });

  it('records action and updates state', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    service.action('S1', 'T1', { type: 'click', targetElementId: 'el_001', reason: 'click login' }, 'PASSED');
    const ctx = service.context('S1', 'T1');
    expect(ctx).toContain('ACTING');
    expect(ctx).toContain('click');
  });

  it('records hypothesis', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    service.hypothesis('S1', 'T1', 'Button may need scroll');
    const ctx = service.context('S1', 'T1');
    expect(ctx).toContain('Hypothesis:');
    expect(ctx).toContain('Button may need scroll');
  });

  it('records rejection and recommendation', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    service.reject('S1', 'T1', 'Element not found', 'Try scrolling');
    const ctx = service.context('S1', 'T1');
    expect(ctx).toContain('Rejected:');
    expect(ctx).toContain('Try scrolling');
  });

  it('records blocker', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    service.block('S1', 'T1', 'Modal blocking interaction');
    const item = service.all()[0];
    expect(item.state).toBe('BLOCKED');
    expect(item.blockers).toContain('Modal blocking interaction');
  });

  it('sets state to DONE', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    service.done('S1', 'T1');
    const item = service.all()[0];
    expect(item.state).toBe('DONE');
  });

  it('limits actionsTried to 8', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'Login', expected: 'Auth ok' });
    for (let i = 0; i < 10; i++) {
      service.action('S1', 'T1', { type: 'click', targetElementId: `el_${i}`, reason: 'test' }, 'PASSED');
    }
    const item = service.all()[0];
    expect(item.actionsTried.length).toBe(8);
    expect(item.actionsTried[0]?.targetElementId).toBe('el_2');
  });

  it('returns empty context for unknown task', () => {
    expect(service.context('X', 'Y')).toBe('');
  });

  it('returns all items', () => {
    service.ensure({ scenarioId: 'S1', taskId: 'T1', objective: 'A', expected: 'B' });
    service.ensure({ scenarioId: 'S1', taskId: 'T2', objective: 'C', expected: 'D' });
    expect(service.all().length).toBe(2);
  });
});
