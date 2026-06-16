import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiService } from '../src/api/api.service.js';
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

describe('ApiService', () => {
  let service: ApiService;
  let cliMock: CliService;

  beforeEach(() => {
    cliMock = makeCliServiceMock();
    service = new ApiService(cliMock);
  });

  it('runs validate-config command', async () => {
    const job = await service.runCommand('validate-config', { config: './test.config.json' });

    expect(job.status).toBe('success');
    expect(job.command).toBe('validate-config');
    expect(job.exitCode).toBe(0);
    expect(job.output).toContain('"ok":true');
    expect(cliMock.validateConfig).toHaveBeenCalledWith({ config: './test.config.json' });
  });

  it('runs run command with args', async () => {
    const job = await service.runCommand('run', {
      config: './agent-qa.config.json',
      headed: true,
      verbose: true,
    });

    expect(job.status).toBe('success');
    expect(job.command).toBe('run');
    expect(cliMock.run).toHaveBeenCalledWith(
      expect.objectContaining({
        config: './agent-qa.config.json',
        headed: true,
        verbose: true,
      }),
    );
  });

  it('runs preflight command', async () => {
    const job = await service.runCommand('preflight', { outputDir: './out' });

    expect(job.status).toBe('success');
    expect(cliMock.preflight).toHaveBeenCalledWith({ outputDir: './out' });
  });

  it('runs onboard command', async () => {
    const job = await service.runCommand('onboard', {
      config: './cfg.json',
      headed: true,
    });

    expect(job.status).toBe('success');
    expect(cliMock.onboard).toHaveBeenCalledWith(expect.objectContaining({ config: './cfg.json', headed: true }));
  });

  it('runs pipeline-all command', async () => {
    const job = await service.runCommand('pipeline-all', {
      config: './cfg.json',
      outputDir: './out',
      projectDir: '/proj',
    });

    expect(job.status).toBe('success');
    expect(cliMock.pipelineAll).toHaveBeenCalledWith(expect.objectContaining({ config: './cfg.json', outputDir: './out', projectDir: '/proj' }));
  });

  it('returns error for unknown command', async () => {
    const job = await service.runCommand('unknown-cmd', {});

    expect(job.status).toBe('error');
    expect(job.exitCode).toBe(1);
    expect(job.error).toContain('Unknown command');
  });

  it('logs job lifecycle', async () => {
    await service.runCommand('validate-config', {});
    const logs = service.getLogs(10);

    expect(logs.some((l) => l.includes('started: validate-config'))).toBe(true);
    expect(logs.some((l) => l.includes('succeeded: validate-config'))).toBe(true);
  });

  it('lists jobs sorted by startedAt desc', async () => {
    const job1 = await service.runCommand('validate-config', {});
    await new Promise((r) => setTimeout(r, 10));
    const job2 = await service.runCommand('preflight', {});

    const jobs = service.getJobs();
    expect(jobs.length).toBe(2);
    expect(jobs[0].id).toBe(job2.id);
    expect(jobs[1].id).toBe(job1.id);
  });

  it('gets job by id', async () => {
    const job = await service.runCommand('validate-config', {});

    expect(service.getJob(job.id)).toEqual(job);
    expect(service.getJob('nonexistent')).toBeUndefined();
  });

  it('limits log buffer size', async () => {
    for (let i = 0; i < 1010; i++) {
      await service.runCommand('validate-config', {});
    }
    const logs = service.getLogs(1000);
    expect(logs.length).toBeLessThanOrEqual(1000);
  });
});
