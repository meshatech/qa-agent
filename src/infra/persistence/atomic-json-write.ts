import { copyFile, rename, unlink } from 'node:fs/promises';

function isCrossDeviceRenameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EXDEV'
  );
}

export interface AtomicJsonWriteFs {
  rename(src: string, dest: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export async function commitAtomicJsonWrite(
  tmpPath: string,
  finalPath: string,
  fs: AtomicJsonWriteFs = { rename, copyFile, unlink },
): Promise<void> {
  try {
    await fs.rename(tmpPath, finalPath);
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }
    await fs.copyFile(tmpPath, finalPath);
    await fs.unlink(tmpPath);
  }
}
