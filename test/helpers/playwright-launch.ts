import { chromium, type Browser } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const NO_SANDBOX_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

function isInsideDocker(): boolean {
  const flag = process.env.QA_AGENT_CONTAINER ?? process.env.QA_AGENT_NO_SANDBOX;
  if (flag !== undefined) return flag === '1' || flag.toLowerCase() === 'true';
  if (existsSync('/.dockerenv')) return true;
  try {
    return /\b(docker|containerd|kubepods|libpod|podman)\b/.test(readFileSync('/proc/self/cgroup', 'utf8'));
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

/**
 * Check if Playwright browsers are installed locally.
 * Useful for skipping browser-dependent tests when running outside Docker.
 */
export function isPlaywrightAvailable(): boolean {
  try {
    const executable = chromium.executablePath();
    return existsSync(executable);
  } catch {
    return false;
  }
}
