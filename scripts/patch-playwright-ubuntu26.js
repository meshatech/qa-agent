#!/usr/bin/env node
/**
 * Patch Playwright's coreBundle.js to treat Ubuntu 26.04 as Ubuntu 24.04
 * until official support lands. Runs automatically via postinstall.
 * Safe no-op on Windows and macOS.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.platform !== 'linux') {
  process.exit(0);
}

function isUbuntu() {
  try {
    const osRelease = readFileSync('/etc/os-release', 'utf8');
    const id = osRelease.match(/^ID=(.+)$/m)?.[1]?.replace(/"/g, '');
    const idLike = osRelease.match(/^ID_LIKE=(.+)$/m)?.[1]?.replace(/"/g, '');
    return id === 'ubuntu' || idLike?.includes('ubuntu') || ['pop', 'neon', 'tuxedo'].includes(id ?? '');
  } catch {
    return false;
  }
}

if (!isUbuntu()) {
  process.exit(0);
}

const coreBundlePath = resolve(
  process.cwd(),
  'node_modules/playwright-core/lib/coreBundle.js'
);

if (!existsSync(coreBundlePath)) {
  process.exit(0);
}

let content = readFileSync(coreBundlePath, 'utf8');
const original = 'if (major < 26)';
const patched = 'if (major < 28)';

if (content.includes(original)) {
  content = content.replaceAll(original, patched);
  writeFileSync(coreBundlePath, content, 'utf8');
  console.log('[patch-playwright-ubuntu26] Applied Ubuntu 26.04 fallback patch.');
} else if (content.includes(patched)) {
  console.log('[patch-playwright-ubuntu26] Patch already applied.');
} else {
  console.warn('[patch-playwright-ubuntu26] Could not find target string; skipping.');
}
