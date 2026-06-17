import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoConfigBuilderService } from '../src/application/services/auto-config-builder.service.js';
import { diffTouchesProtected } from '../src/application/helpers/diff-touches-protected.helper.js';
import { JsonObjectExtractor, SafeJsonParser } from '../src/infra/llm/llm-output-normalizer.js';
import { ProjectKnowledgeSchema, type ProjectKnowledge } from '../src/domain/schemas/project-knowledge.schema.js';
import type { PrDiffContext } from '../src/domain/schemas/pr-diff-context.schema.js';
import type { DemandContext } from '../src/domain/schemas/demand-context.schema.js';

const jsonParser = new SafeJsonParser(new JsonObjectExtractor());

function makeKnowledge(over: Partial<ProjectKnowledge> = {}): ProjectKnowledge {
  return ProjectKnowledgeSchema.parse({
    metadata: { repo: 'meshatech/kriya-web', branch: 'release', analyzedAt: new Date().toISOString(), confidence: 'high' },
    auth: { kind: 'none' },
    ...over,
  });
}

function makePrDiff(over: Partial<PrDiffContext> = {}): PrDiffContext {
  return {
    schemaVersion: 'pr-diff-context.v1',
    pullRequest: { prNumber: 94, baseBranch: 'release', headBranch: 'feat/x', title: 'X', author: 'dev' },
    changedFiles: [
      { path: 'src/pages/home.tsx', status: 'modified', positiveLines: [], negativeLines: [], contextLines: [], kind: 'route' },
    ],
    affectedRoutes: [],
    affectedSchemas: [],
    ...over,
  } as PrDiffContext;
}

const demand = {
  taskId: 'MESHAP-1',
  title: 'Tela de dashboard',
  description: 'Validar dashboard',
  acceptanceCriteria: ['Carrega em <2s'],
} as DemandContext;

function makeBuilder(opts: {
  knowledge: ProjectKnowledge;
  llmContent?: string;
}) {
  const memory = { resolve: vi.fn().mockResolvedValue({ knowledge: opts.knowledge, fromMemory: true, analyzed: false }) };
  const llm = { complete: vi.fn().mockResolvedValue({ content: opts.llmContent ?? '{}', model: 'fake' }) };
  const service = new AutoConfigBuilderService(memory as never, llm as never, jsonParser);
  return { service, memory, llm };
}

let savedEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  savedEnv = { ...process.env };
});
afterEach(() => {
  process.env = savedEnv;
  vi.restoreAllMocks();
});

describe('AutoConfigBuilderService.build', () => {
  it('produces baseUrl, appDomains, demand and pr deterministically', async () => {
    const { service } = makeBuilder({ knowledge: makeKnowledge() });
    const out = await service.build({
      previewUrl: 'https://kriya-pr-94.preview.kriya-hml.mesha.com.br',
      prDiff: makePrDiff(),
      demand,
      projectPath: process.cwd(),
      repo: 'meshatech/kriya-web',
      env: {},
    });

    expect(out.config.baseUrl).toBe('https://kriya-pr-94.preview.kriya-hml.mesha.com.br');
    expect(out.config.appDomains).toEqual(['kriya-pr-94.preview.kriya-hml.mesha.com.br']);
    expect(out.config.demand.id).toBe('MESHAP-1');
    expect(out.config.demand.acceptanceCriteria).toEqual(['Carrega em <2s']);
    expect(out.config.pr?.repository).toBe('meshatech/kriya-web');
    expect(out.config.pr?.pullNumber).toBe(94);
    expect(out.config.auth.kind).toBe('none');
  });

  it('prefers storageState when QA_AGENT_STORAGE_STATE is set', async () => {
    const { service } = makeBuilder({
      knowledge: makeKnowledge({ auth: { kind: 'formLogin', loginUrl: '/login', selectors: { username: 'a', password: 'b', submit: 'c' } } }),
    });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff({ affectedRoutes: ['/dashboard'] }),
      demand,
      projectPath: process.cwd(),
      env: { QA_AGENT_STORAGE_STATE: '/tmp/storage-state.json' },
    });
    expect(out.config.auth.kind).toBe('storageState');
    if (out.config.auth.kind === 'storageState') expect(out.config.auth.path).toBe('/tmp/storage-state.json');
  });

  it('infers formLogin when diff touches a protected module', async () => {
    const knowledge = makeKnowledge({
      auth: {
        kind: 'formLogin',
        loginUrl: '/login',
        loginModule: 'src/modules/auth/',
        selectors: { username: 'input[name="email"]', password: 'input[name="password"]', submit: 'button[type="submit"]' },
      },
      modulesRequiringAuth: [{ name: 'Dashboard', route: '/dashboard', requiresAuth: true }],
    });
    const { service } = makeBuilder({ knowledge });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff({ affectedRoutes: ['/dashboard'] }),
      demand,
      projectPath: process.cwd(),
      env: { QA_USERNAME_ENV: 'KRIYA_USER', QA_PASSWORD_ENV: 'KRIYA_PASS' },
    });
    expect(out.config.auth.kind).toBe('formLogin');
    if (out.config.auth.kind === 'formLogin') {
      expect(out.config.auth.usernameSelector).toBe('input[name="email"]');
      expect(out.config.auth.usernameEnv).toBe('KRIYA_USER');
    }
  });

  it('falls back to none when formLogin module is not touched by the diff', async () => {
    const knowledge = makeKnowledge({
      auth: { kind: 'formLogin', loginUrl: '/login', loginModule: 'src/modules/auth/', selectors: { username: 'a', password: 'b', submit: 'c' } },
      modulesRequiringAuth: [{ name: 'Dashboard', route: '/dashboard', requiresAuth: true }],
    });
    const { service } = makeBuilder({ knowledge });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff({ affectedRoutes: ['/public'] }),
      demand,
      projectPath: process.cwd(),
      env: {},
    });
    expect(out.config.auth.kind).toBe('none');
  });

  it('infers ssoRedirect with only the login button when IdP selectors are unknown', async () => {
    const knowledge = makeKnowledge({
      auth: { kind: 'ssoRedirect', idp: 'WSO2', loginUrl: '/login', loginModule: 'src/modules/auth/', selectors: { loginButton: 'button[data-testid="sso-login"]' } },
      modulesRequiringAuth: [{ name: 'Dashboard', route: '/dashboard', requiresAuth: true }],
    });
    const { service } = makeBuilder({ knowledge });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff({ affectedRoutes: ['/dashboard'] }),
      demand,
      projectPath: process.cwd(),
      env: {},
    });
    expect(out.config.auth.kind).toBe('ssoRedirect');
    if (out.config.auth.kind === 'ssoRedirect') {
      expect(out.config.auth.loginButtonSelector).toBe('button[data-testid="sso-login"]');
      expect(out.config.auth.idpUsernameSelector).toBeUndefined();
      expect(out.config.auth.usernameEnv).toBeUndefined();
    }
  });

  it('enriches ssoRedirect with IdP selectors and envs when the IdP form is fully known', async () => {
    const knowledge = makeKnowledge({
      auth: {
        kind: 'ssoRedirect',
        idp: 'Keycloak',
        loginUrl: '/login',
        loginModule: 'src/modules/auth/',
        storageStatePath: '/tmp/sso-state.json',
        selectors: {
          loginButton: '#sso',
          idpUsername: '#idp-user',
          idpPassword: '#idp-pass',
          idpSubmit: '#idp-submit',
        },
        successWhen: { urlContains: '/dashboard' },
      },
      modulesRequiringAuth: [{ name: 'Dashboard', route: '/dashboard', requiresAuth: true }],
    });
    const { service } = makeBuilder({ knowledge });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff({ affectedRoutes: ['/dashboard'] }),
      demand,
      projectPath: process.cwd(),
      env: { QA_USERNAME_ENV: 'SSO_USER', QA_PASSWORD_ENV: 'SSO_PASS' },
    });
    expect(out.config.auth.kind).toBe('ssoRedirect');
    if (out.config.auth.kind === 'ssoRedirect') {
      expect(out.config.auth.idpUsernameSelector).toBe('#idp-user');
      expect(out.config.auth.idpPasswordSelector).toBe('#idp-pass');
      expect(out.config.auth.idpSubmitSelector).toBe('#idp-submit');
      expect(out.config.auth.usernameEnv).toBe('SSO_USER');
      expect(out.config.auth.passwordEnv).toBe('SSO_PASS');
      expect(out.config.auth.storageStatePath).toBe('/tmp/sso-state.json');
      expect(out.config.auth.successWhen?.urlContains).toBe('/dashboard');
    }
  });

  it('warns and omits IdP automation when ssoRedirect IdP selectors are partial', async () => {
    const knowledge = makeKnowledge({
      auth: { kind: 'ssoRedirect', loginUrl: '/login', loginModule: 'src/modules/auth/', selectors: { loginButton: '#sso', idpUsername: '#idp-user' } },
      modulesRequiringAuth: [{ name: 'Dashboard', route: '/dashboard', requiresAuth: true }],
    });
    const { service } = makeBuilder({ knowledge });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff({ affectedRoutes: ['/dashboard'] }),
      demand,
      projectPath: process.cwd(),
      env: {},
    });
    expect(out.config.auth.kind).toBe('ssoRedirect');
    if (out.config.auth.kind === 'ssoRedirect') {
      expect(out.config.auth.idpUsernameSelector).toBeUndefined();
      expect(out.config.auth.usernameEnv).toBeUndefined();
    }
    expect(out.warnings.some((w) => w.includes('IdP selectors incomplete'))).toBe(true);
  });

  it('seeds classifier tracking domains and noise patterns from project knowledge', async () => {
    const knowledge = makeKnowledge({
      consoleNoisePatterns: ['ResizeObserver loop'],
      knownTrackingDomains: ['google-analytics.com', 'doubleclick.net'],
    });
    const { service } = makeBuilder({ knowledge });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff(),
      demand,
      projectPath: process.cwd(),
      env: {},
    });
    expect(out.config.classifier?.knownTrackingDomains).toEqual(['google-analytics.com', 'doubleclick.net']);
    expect(out.config.classifier?.knownNoiseRegexes).toEqual(['ResizeObserver loop']);
  });

  it('merges LLM enrichment (maxScenarios, allowedRoutes)', async () => {
    const { service } = makeBuilder({
      knowledge: makeKnowledge(),
      llmContent: '```json\n{ "maxScenarios": 3, "allowedRoutes": ["/dashboard", "/settings"] }\n```',
    });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff(),
      demand,
      projectPath: process.cwd(),
      env: {},
    });
    expect(out.config.scenarioSelection?.maxScenarios).toBe(3);
    expect(out.config.allowedRoutes).toEqual(['/dashboard', '/settings']);
  });

  it('survives an unusable LLM enrichment response', async () => {
    const { service } = makeBuilder({ knowledge: makeKnowledge(), llmContent: 'not json at all' });
    const out = await service.build({
      previewUrl: 'https://app.example.com',
      prDiff: makePrDiff(),
      demand,
      projectPath: process.cwd(),
      env: {},
    });
    expect(out.config.baseUrl).toBe('https://app.example.com');
    expect(out.warnings.some((w) => w.includes('enrichment'))).toBe(true);
  });
});

describe('diffTouchesProtected', () => {
  it('detects an affected protected route', () => {
    const knowledge = makeKnowledge({ modulesRequiringAuth: [{ name: 'D', route: '/dashboard', requiresAuth: true }] });
    expect(diffTouchesProtected(makePrDiff({ affectedRoutes: ['/dashboard'] }), knowledge)).toBe(true);
  });

  it('detects a changed file under the login module', () => {
    const knowledge = makeKnowledge({ auth: { kind: 'formLogin', loginModule: 'src/modules/auth/' } });
    const prDiff = makePrDiff({
      changedFiles: [{ path: 'src/modules/auth/login.tsx', status: 'modified', positiveLines: [], negativeLines: [], contextLines: [], kind: 'route' }],
    });
    expect(diffTouchesProtected(prDiff, knowledge)).toBe(true);
  });

  it('returns false when nothing protected is touched', () => {
    const knowledge = makeKnowledge({ modulesRequiringAuth: [{ name: 'D', route: '/dashboard', requiresAuth: true }] });
    expect(diffTouchesProtected(makePrDiff({ affectedRoutes: ['/public'] }), knowledge)).toBe(false);
  });
});
