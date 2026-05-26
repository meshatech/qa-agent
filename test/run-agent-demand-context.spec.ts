import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunAgentUseCase } from '../src/application/use-cases/run-agent.usecase.js';

const useCase = Object.create(RunAgentUseCase.prototype) as {
  demandContextPersistence: { persistFromClickUpTask: ReturnType<typeof vi.fn> };
  persistClickUpDemandContext(runDir: string, config: { clickup?: { taskId?: string; teamId?: string } }): Promise<void>;
};

describe('RunAgentUseCase ClickUp demand context', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('skips persistence when CLICKUP_TOKEN is missing', async () => {
    const persist = vi.fn();
    useCase.demandContextPersistence = { persistFromClickUpTask: persist };
    vi.stubEnv('CLICKUP_TOKEN', '');

    await useCase.persistClickUpDemandContext('/run', { clickup: { taskId: 'PRJ-11318', teamId: '123' } });

    expect(persist).not.toHaveBeenCalled();
  });

  it('skips persistence when no task id is configured', async () => {
    const persist = vi.fn();
    useCase.demandContextPersistence = { persistFromClickUpTask: persist };
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test');
    vi.stubEnv('CLICKUP_TASK_ID', '');

    await useCase.persistClickUpDemandContext('/run', {});

    expect(persist).not.toHaveBeenCalled();
  });

  it('persists demand-context.json when token and config task id are present', async () => {
    const persist = vi.fn().mockResolvedValue({
      path: '/run/demand-context.json',
      demand: { taskId: 'PRJ-11318', title: 'Task', description: 'Body' },
    });
    useCase.demandContextPersistence = { persistFromClickUpTask: persist };
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test');

    await useCase.persistClickUpDemandContext('/run', {
      clickup: { taskId: 'PRJ-11318', teamId: '9012345678' },
    });

    expect(persist).toHaveBeenCalledWith('/run', 'pk_test', {
      configTaskId: 'PRJ-11318',
      configTeamId: '9012345678',
    });
  });

  it('uses CLICKUP_TASK_ID env when config task id is absent', async () => {
    const persist = vi.fn().mockResolvedValue({
      path: '/run/demand-context.json',
      demand: { taskId: 'PRJ-11318', title: 'Task', description: 'Body' },
    });
    useCase.demandContextPersistence = { persistFromClickUpTask: persist };
    vi.stubEnv('CLICKUP_TOKEN', 'pk_test');
    vi.stubEnv('CLICKUP_TASK_ID', 'PRJ-11318');

    await useCase.persistClickUpDemandContext('/run', { clickup: { teamId: '9012345678' } });

    expect(persist).toHaveBeenCalledWith('/run', 'pk_test', {
      configTaskId: undefined,
      configTeamId: '9012345678',
    });
  });
});
