import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiController } from '../src/api/api.controller.js';
import { ApiService } from '../src/api/api.service.js';
import { type ApiJob } from '../src/api/models/index.js';
import { CliService } from '../src/cli/cli.service.js';

function makeCliServiceMock(): CliService {
  return {
    run: vi.fn().mockResolvedValue({ output: '{"status":"PASSED"}', exitCode: 0 }),
    captureAuth: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    validateConfig: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    preflight: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    readPrContext: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    pipelineAll: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    pipelinePrepare: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    pipelineCorrelate: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    onboard: vi.fn().mockResolvedValue({ output: '{"status":"READY"}', exitCode: 0 }),
    inspect: vi.fn().mockResolvedValue({ output: '{"ok":true}', exitCode: 0 }),
    report: vi.fn().mockResolvedValue({ output: '# Report', exitCode: 0 }),
  } as unknown as CliService;
}

describe('ApiController', () => {
  let controller: ApiController;
  let service: ApiService;

  beforeEach(() => {
    const cliMock = makeCliServiceMock();
    service = new ApiService(cliMock);
    controller = new ApiController(service);
  });

  it('health returns ok', () => {
    const result = controller.health();

    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeDefined();
  });

  it('run dispatches command to service', async () => {
    const body = { command: 'validate-config', args: { config: './test.json' } };

    const result = (await controller.run(body)) as ApiJob;

    expect(result.status).toBe('success');
    expect(result.command).toBe('validate-config');
  });

  it('listJobs returns all jobs', async () => {
    await service.runCommand('validate-config', {});
    await service.runCommand('preflight', {});

    const result = controller.listJobs() as ApiJob[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });

  it('getJob returns existing job', async () => {
    const job = await service.runCommand('validate-config', {});

    const result = controller.getJob(job.id) as ApiJob;

    expect(result.id).toBe(job.id);
  });

  it('getJob returns error for unknown id', () => {
    const result = controller.getJob('nonexistent');

    expect(result).toEqual({ error: 'Job not found' });
  });

  it('getLogs returns log entries', async () => {
    await service.runCommand('validate-config', {});

    const result = controller.getLogs();

    expect(Array.isArray(result.logs)).toBe(true);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it('getLogs respects tail param', async () => {
    await service.runCommand('validate-config', {});
    await service.runCommand('preflight', {});

    const result = controller.getLogs('1');

    expect(result.logs.length).toBeLessThanOrEqual(1);
  });
});
