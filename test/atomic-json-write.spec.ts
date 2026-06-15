import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAtomicJsonWrite } from '../src/infra/persistence/atomic-json-write.js';

describe('commitAtomicJsonWrite', () => {
  const rename = vi.fn();
  const copyFile = vi.fn();
  const unlink = vi.fn();

  const fs = { rename, copyFile, unlink };

  beforeEach(() => {
    rename.mockReset();
    copyFile.mockReset();
    unlink.mockReset();
  });

  it('uses rename when same filesystem', async () => {
    rename.mockResolvedValue(undefined);

    await commitAtomicJsonWrite('/tmp/output.json.tmp', '/tmp/output.json', fs);

    expect(rename).toHaveBeenCalledWith('/tmp/output.json.tmp', '/tmp/output.json');
    expect(copyFile).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('falls back to copyFile when rename fails with EXDEV', async () => {
    const exdevError = Object.assign(new Error('EXDEV: cross-device link not permitted'), {
      code: 'EXDEV',
    });
    rename.mockRejectedValueOnce(exdevError);
    copyFile.mockResolvedValue(undefined);
    unlink.mockResolvedValue(undefined);

    await commitAtomicJsonWrite('/tmp/output.json.tmp', '/tmp/output.json', fs);

    expect(rename).toHaveBeenCalledWith('/tmp/output.json.tmp', '/tmp/output.json');
    expect(copyFile).toHaveBeenCalledWith('/tmp/output.json.tmp', '/tmp/output.json');
    expect(unlink).toHaveBeenCalledWith('/tmp/output.json.tmp');
  });

  it('rethrows non-EXDEV rename errors', async () => {
    const error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    rename.mockRejectedValueOnce(error);

    await expect(commitAtomicJsonWrite('/tmp/output.json.tmp', '/tmp/output.json', fs)).rejects.toBe(error);
    expect(copyFile).not.toHaveBeenCalled();
  });
});
