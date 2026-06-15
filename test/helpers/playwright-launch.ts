import { chromium, type Browser } from 'playwright';
import { readFileSync } from 'node:fs';

const NO_SANDBOX_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];

function isInsideDocker(): boolean {
  try {
    return readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
  } catch {
    return false;
  }
}

export function launchBrowser(headless = true): Promise<Browser> {
  return chromium.launch({
    headless,
    args: isInsideDocker() ? NO_SANDBOX_ARGS : undefined,
  });
}
