import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { readRequiredScenarios } from '../src/application/helpers/read-required-scenarios.js';
import { ConfigError } from '../src/domain/errors.js';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'qa-agent-test-'));
}

describe('readRequiredScenarios', () => {
  it('reads valid required-scenarios.json and returns RequiredScenario[]', async () => {
    const dir = await tempDir();
    const filePath = join(dir, 'required-scenarios.json');
    const content = {
      schemaVersion: 'correlation-result.v1',
      status: 'OK',
      scenarios: [
        { id: 'REQ-001', title: 'Login', intent: 'POSITIVE', rationale: 'Validate login', relatedFiles: [], riskScore: 0.5 },
        { id: 'REQ-002', title: 'Logout', intent: 'POSITIVE', rationale: 'Validate logout', relatedFiles: [], riskScore: 0.3 },
      ],
      correlations: [],
      risks: [],
      warnings: [],
    };
    await writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');

    const result = await readRequiredScenarios(filePath);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('REQ-001');
    expect(result[0].title).toBe('Login');
    expect(result[1].id).toBe('REQ-002');

    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty array when scenarios is empty', async () => {
    const dir = await tempDir();
    const filePath = join(dir, 'required-scenarios.json');
    const content = {
      schemaVersion: 'correlation-result.v1',
      status: 'OK',
      scenarios: [],
      correlations: [],
      risks: [],
      warnings: [],
    };
    await writeFile(filePath, JSON.stringify(content), 'utf8');

    const result = await readRequiredScenarios(filePath);

    expect(result).toHaveLength(0);

    await rm(dir, { recursive: true, force: true });
  });

  it('throws ConfigError when file does not exist', async () => {
    await expect(readRequiredScenarios('/nonexistent/required-scenarios.json')).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError when file contains invalid JSON', async () => {
    const dir = await tempDir();
    const filePath = join(dir, 'required-scenarios.json');
    await writeFile(filePath, 'not-json', 'utf8');

    await expect(readRequiredScenarios(filePath)).rejects.toThrow(ConfigError);

    await rm(dir, { recursive: true, force: true });
  });

  it('throws ConfigError when JSON fails schema validation', async () => {
    const dir = await tempDir();
    const filePath = join(dir, 'required-scenarios.json');
    await writeFile(filePath, JSON.stringify({ invalid: true }), 'utf8');

    await expect(readRequiredScenarios(filePath)).rejects.toThrow(ConfigError);

    await rm(dir, { recursive: true, force: true });
  });

  it('resolves relative paths', async () => {
    const dir = await tempDir();
    const filePath = join(dir, 'required-scenarios.json');
    const content = {
      schemaVersion: 'correlation-result.v1',
      status: 'OK',
      scenarios: [{ id: 'REQ-001', title: 'Test', intent: 'POSITIVE', rationale: 'Test', relatedFiles: [], riskScore: 0 }],
      correlations: [],
      risks: [],
      warnings: [],
    };
    await writeFile(filePath, JSON.stringify(content), 'utf8');

    const relativePath = filePath.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '');
    const result = await readRequiredScenarios(relativePath);

    expect(result).toHaveLength(1);

    await rm(dir, { recursive: true, force: true });
  });
});
