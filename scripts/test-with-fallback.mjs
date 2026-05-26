#!/usr/bin/env node
/**
 * Runs tests in Docker (qa-agent-playwright) when the image exists,
 * otherwise locally if Playwright browsers are available.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2).join(' ');

function isInsideDocker() {
  return existsSync('/.dockerenv');
}

function dockerBinary() {
  for (const bin of ['sudo docker', 'docker']) {
    try {
      execSync(`${bin} info`, { stdio: 'pipe' });
      return bin;
    } catch {
      continue;
    }
  }
  return null;
}

function hasDockerImage(docker) {
  try {
    const id = execSync(`${docker} images -q qa-agent-playwright`, {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return id.length > 0;
  } catch {
    return false;
  }
}

function hasPlaywrightBrowsers() {
  try {
    const output = execSync('npx playwright install --dry-run', {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return !output.includes('will install') && !output.includes('to install');
  } catch {
    return false;
  }
}

function runVitestLocally() {
  console.log('[test-with-fallback] Running tests locally...');
  execSync(`npx vitest run ${args}`, { stdio: 'inherit' });
}

function runVitestInDocker(docker) {
  const envFile = existsSync('.env') ? '--env-file .env ' : '';
  const vitestCmd = args ? `npx vitest run ${args}` : 'npx vitest run';
  console.log('[test-with-fallback] Running tests via Docker (qa-agent-playwright)...');
  execSync(
    `${docker} run --rm ${envFile}-v "${process.cwd()}:/app" -w /app qa-agent-playwright ${vitestCmd}`,
    { stdio: 'inherit' },
  );
}

if (isInsideDocker()) {
  runVitestLocally();
  process.exit(0);
}

const docker = dockerBinary();
if (docker && hasDockerImage(docker)) {
  runVitestInDocker(docker);
} else if (hasPlaywrightBrowsers()) {
  runVitestLocally();
} else {
  console.error(
    '[test-with-fallback] ERROR: Docker image qa-agent-playwright not built and Playwright browsers not found.',
  );
  console.error('Run: sudo docker build -f Dockerfile.playwright -t qa-agent-playwright .');
  process.exit(1);
}
