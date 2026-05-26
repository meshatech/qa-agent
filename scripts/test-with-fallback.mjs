#!/usr/bin/env node
/**
 * Runs tests locally if Playwright browsers are available,
 * otherwise falls back to Docker container.
 */
import { execSync } from 'node:child_process';


function hasPlaywrightBrowsers() {
  try {
    // Check if the browser revision expected by installed Playwright is present
    const output = execSync('npx playwright install --dry-run', { encoding: 'utf8', stdio: 'pipe' });
    // If it says "already installed" or nothing to install, we're good
    return !output.includes('will install') && !output.includes('to install');
  } catch {
    return false;
  }
}

function hasDockerImage() {
  try {
    execSync('sudo docker images -q qa-agent-playwright', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const args = process.argv.slice(2).join(' ');

if (hasDockerImage()) {
  console.log('[test-with-fallback] Running tests via Docker (qa-agent-playwright)...');
  execSync('sudo docker run --rm qa-agent-playwright', { stdio: 'inherit' });
} else if (hasPlaywrightBrowsers()) {
  console.log('[test-with-fallback] Running tests locally...');
  execSync(`npx vitest run ${args}`, { stdio: 'inherit' });
} else {
  console.error('[test-with-fallback] ERROR: Docker image qa-agent-playwright not built and Playwright browsers not found.');
  console.error('Run: docker build -f Dockerfile.playwright -t qa-agent-playwright .');
  process.exit(1);
}
