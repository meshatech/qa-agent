import { copyFile, rename, unlink } from 'node:fs/promises';

function isCrossDeviceRenameError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EXDEV'
  );
}

export async function commitAtomicJsonWrite(tmpPath: string, finalPath: string): Promise<void> {
  try {
    await rename(tmpPath, finalPath);
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }
    await copyFile(tmpPath, finalPath);
    await unlink(tmpPath);
  }
}
