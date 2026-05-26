#!/usr/bin/env node
/**
 * Validates .cursor/ rules and memory bank + .agent-qa/ format.
 * Usage: node scripts/validate-agent-config.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const errors = [];

function fail(msg) {
  errors.push(msg);
}

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function exists(path) {
  return existsSync(join(ROOT, path));
}

// --- Rules ---
const RULES_DIR = '.cursor/rules';
const EXPECTED_RULE_COUNT = 12;
const MAX_RULE_LINES = 55;

if (!exists(RULES_DIR)) {
  fail(`Missing ${RULES_DIR}/`);
} else {
  const ruleFiles = readdirSync(join(ROOT, RULES_DIR)).filter((f) => f.endsWith('.mdc'));
  if (ruleFiles.length !== EXPECTED_RULE_COUNT) {
    fail(`Expected ${EXPECTED_RULE_COUNT} .mdc rules, found ${ruleFiles.length}`);
  }
  for (const file of ruleFiles) {
    const content = read(join(RULES_DIR, file));
    const lines = content.split('\n').length;
    if (lines > MAX_RULE_LINES) {
      fail(`${RULES_DIR}/${file}: ${lines} lines (max ${MAX_RULE_LINES})`);
    }
    if (!content.startsWith('---')) {
      fail(`${RULES_DIR}/${file}: missing YAML frontmatter`);
    } else {
      const fm = content.slice(0, content.indexOf('---', 3));
      const hasDesc = /description:/.test(fm);
      const hasAlways = /alwaysApply:\s*true/.test(fm);
      if (!hasDesc && !hasAlways) {
        fail(`${RULES_DIR}/${file}: frontmatter needs description or alwaysApply: true`);
      }
    }
  }
}

// --- Memory bank ---
const MEMORY_FILES = [
  '.cursor/memory/README.md',
  '.cursor/memory/project-brief.md',
  '.cursor/memory/architecture.md',
  '.cursor/memory/conventions.md',
  '.cursor/memory/decisions.md',
  '.cursor/memory/active-context.md',
  '.cursor/memory/progress.md',
];

for (const file of MEMORY_FILES) {
  if (!exists(file)) {
    fail(`Missing memory file: ${file}`);
    continue;
  }
  const body = read(file).replace(/^#.*$/m, '').trim();
  if ((file.endsWith('active-context.md') || file.endsWith('progress.md')) && body.length < 20) {
    fail(`${file}: content too short (must not be empty)`);
  }
}

// --- AGENTS.md ---
if (!exists('AGENTS.md')) {
  fail('Missing AGENTS.md at repo root');
}

// --- .agent-qa/memory.md chunks ---
const memoryMd = exists('.agent-qa/memory.md') ? read('.agent-qa/memory.md') : '';
if (!memoryMd) {
  fail('Missing .agent-qa/memory.md');
} else {
  const chunkMeta = [...memoryMd.matchAll(/<!--\s*type:\s*(\w+)\s*\|\s*id:\s*([A-Z0-9-]+)\s*-->/gi)];
  const sections = memoryMd.split(/^## /m).slice(1);
  if (sections.length > 0 && chunkMeta.length < sections.length) {
    fail(`.agent-qa/memory.md: ${sections.length} sections but only ${chunkMeta.length} chunk metadata blocks`);
  }
  const ids = chunkMeta.map((m) => m[2].toUpperCase());
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    fail(`.agent-qa/memory.md: duplicate chunk ids: ${[...new Set(dupes)].join(', ')}`);
  }
  for (const m of chunkMeta) {
    if (!m[1] || !m[2]) {
      fail('.agent-qa/memory.md: malformed chunk metadata');
    }
  }
}

// --- Secret patterns (literal credentials, not doc mentions) ---
const SECRET_PATTERNS = [
  { name: 'OpenAI-style key', re: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'GitHub token', re: /ghp_[a-zA-Z0-9]{20,}/ },
  { name: 'Fixture password literal', re: /good-password/ },
  { name: 'Literal password assignment', re: /(?:password|senha)\s*[:=]\s*['"]?[\w@.-]{6,}['"]?/i },
];

const SCAN_PATHS = ['.cursor/memory', '.agent-qa'];
for (const dir of SCAN_PATHS) {
  if (!exists(dir)) continue;
  for (const file of walkMd(join(ROOT, dir))) {
    const rel = file.slice(ROOT.length + 1);
    const lines = read(rel).split('\n');
    lines.forEach((line, idx) => {
      if (/^\s*#/.test(line) || /proibido|never|nunca|sem secrets|usernameEnv|passwordEnv/i.test(line)) {
        return;
      }
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(line)) {
          fail(`${rel}:${idx + 1}: possible secret (${name})`);
        }
      }
    });
  }
}

function walkMd(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walkMd(p));
    } else if (name.endsWith('.md') || name.endsWith('.mdc') || name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

// --- Report ---
if (errors.length) {
  console.error('validate-agent-config: FAILED\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('validate-agent-config: OK');
console.log(`  - ${EXPECTED_RULE_COUNT} rules in ${RULES_DIR}/`);
console.log(`  - ${MEMORY_FILES.length} memory bank files`);
console.log(`  - .agent-qa/memory.md chunk format valid`);
