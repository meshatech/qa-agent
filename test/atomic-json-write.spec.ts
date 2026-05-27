import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rename, copyFile, unlink } = vi.hoisted(() => ({
  rename: vi.fn(),
  copyFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  rename,
  copyFile,
  unlink,
}));

import { commitAtomicJsonWrite } from '../src/infra/persistence/atomic-json-write.js';

describe('commitAtomicJsonWrite', () => {
  beforeEach(() => {
    rename.mockReset();
    copyFile.mockReset();
    unlink.mockReset();
  });

  it('uses rename when same filesystem', async () => {
    rename.mockResolvedValue(undefined);

    await commitAtomicJsonWrite('/tmp/output.json.tmp', '/tmp/output.json');

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

    await commitAtomicJsonWrite('/tmp/output.json.tmp', '/tmp/output.json');

    expect(rename).toHaveBeenCalledWith('/tmp/output.json.tmp', '/tmp/output.json');
    expect(copyFile).toHaveBeenCalledWith('/tmp/output.json.tmp', '/tmp/output.json');
    expect(unlink).toHaveBeenCalledWith('/tmp/output.json.tmp');
  });

  it('rethrows non-EXDEV rename errors', async () => {
    const error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    rename.mockRejectedValueOnce(error);

    await expect(commitAtomicJsonWrite('/tmp/output.json.tmp', '/tmp/output.json')).rejects.toBe(error);
    expect(copyFile).not.toHaveBeenCalled();
  });
});
