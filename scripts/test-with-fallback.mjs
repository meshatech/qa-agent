#!/usr/bin/env node
/**
 * Runs tests in Docker (qa-agent-playwright) when the image exists,
 * otherwise locally if Playwright browsers are available.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2).join(' ');

function canConnectToPostgres() {
  if (process.env.SKIP_PG_TESTS === '1') return false;
  try {
    const url = process.env.DATABASE_URL ?? 'postgresql://agent_qa:agent_qa@localhost:5433/agent_qa_memory';
    const match = url.match(/@([^:]+):(\d+)\//);
    if (!match) return false;
    const [, host, port] = match;
    execSync(`nc -z ${host} ${port}`, { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

if (!canConnectToPostgres()) {
  process.env.SKIP_PG_TESTS = '1';
}

function isInsideDocker() {
  return existsSync('/.dockerenv');
}

function dockerBinary() {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return 'docker';
  } catch {
    return null;
  }
}

function dockerUserFlags() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
  return `--user ${uid}:${gid}`;
}

function hasDockerImage(docker, name) {
  try {
    const id = execSync(`${docker} images -q ${name}`, {
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

function runVitestInDocker(docker, image) {
  const envFile = existsSync('.env') ? '--env-file .env ' : '';
  const vitestCmd = args ? `npx vitest run ${args}` : 'npx vitest run';
  console.log(`[test-with-fallback] Running tests via Docker (${image})...`);
  execSync(
    `${docker} run --rm --entrypoint "" ${dockerUserFlags()} ${envFile}-v "${process.cwd()}:/app" -w /app ${image} ${vitestCmd}`,
    { stdio: 'inherit' },
  );
}

if (isInsideDocker()) {
  runVitestLocally();
  process.exit(0);
}

const docker = dockerBinary();
const preferredImage = hasDockerImage(docker, 'qa-agent:local') ? 'qa-agent:local'
  : hasDockerImage(docker, 'qa-agent-playwright') ? 'qa-agent-playwright'
  : null;

if (docker && preferredImage) {
  runVitestInDocker(docker, preferredImage);
} else if (hasPlaywrightBrowsers()) {
  runVitestLocally();
} else {
  console.error(
    '[test-with-fallback] ERROR: No Docker image found (qa-agent:local or qa-agent-playwright) and Playwright browsers not installed.',
  );
  console.error('Run: docker build -t qa-agent:local .');
  process.exit(1);
}
