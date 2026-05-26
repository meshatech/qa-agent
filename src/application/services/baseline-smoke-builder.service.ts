import { Injectable } from '@nestjs/common';

import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ExecutionPlan } from '../../domain/schemas/execution-plan.schema.js';
import type { LocatorDescriptor } from '../../domain/schemas/action.schema.js';

/**
 * Builds a minimal baseline smoke ExecutionPlan from RunConfig.
 *
 * Covers:
 * - Navigation to baseUrl
 * - Form login (if configured)
 * - Access to allowedRoutes
 * - DOM / console verification
 *
 * No destructive actions (runtime.destructiveActionPolicy = 'BLOCK').
 */
@Injectable()
export class BaselineSmokeBuilderService {
  build(config: RunConfig): ExecutionPlan {
    const steps: ExecutionPlan['steps'] = [];

    // Step 1: navigate to baseUrl
    steps.push({
      id: 'ONB-001',
      description: 'Navigate to base URL',
      preconditions: [],
      action: { type: 'navigate', to: config.baseUrl, reason: 'Onboarding: navigate to project base URL' },
      postconditions: [{ type: 'url_contains', value: config.baseUrl }],
      assertions: [{ type: 'no_console_errors' }],
      onFailure: 'BLOCK',
    });

    // Step 2: perform form login if configured
    if (config.auth.kind === 'formLogin') {
      const username = process.env[config.auth.usernameEnv] ?? '';
      const password = process.env[config.auth.passwordEnv] ?? '';

      if (username && password) {
        steps.push({
          id: 'ONB-002',
          description: 'Fill login username',
          preconditions: [],
          action: { type: 'fill', target: this.toLocator(config.auth.usernameSelector), value: username, reason: 'Onboarding: fill login username' },
          postconditions: [{ type: 'element_visible', target: this.toLocator(config.auth.usernameSelector) }],
          assertions: [],
          onFailure: 'BLOCK',
        });

        steps.push({
          id: 'ONB-003',
          description: 'Fill login password',
          preconditions: [],
          action: { type: 'fill', target: this.toLocator(config.auth.passwordSelector), value: password, reason: 'Onboarding: fill login password' },
          postconditions: [{ type: 'element_visible', target: this.toLocator(config.auth.passwordSelector) }],
          assertions: [],
          onFailure: 'BLOCK',
        });

        steps.push({
          id: 'ONB-004',
          description: 'Submit login form',
          preconditions: [],
          action: { type: 'click', target: this.toLocator(config.auth.submitSelector), reason: 'Onboarding: submit login form' },
          postconditions: config.auth.successWhen
            ? config.auth.successWhen.textVisible
              ? [{ type: 'text_visible', text: config.auth.successWhen.textVisible }]
              : [{ type: 'url_contains', value: config.auth.successWhen.urlContains ?? config.baseUrl }]
            : config.auth.successUrlContains
              ? [{ type: 'url_contains', value: config.auth.successUrlContains }]
              : [{ type: 'no_console_errors' }],
          assertions: [{ type: 'no_console_errors' }],
          onFailure: 'BLOCK',
        });
      } else {
        steps.push({
          id: 'ONB-002-WARN',
          description: 'Warn missing login credentials',
          preconditions: [],
          action: { type: 'waitForStable', timeoutMs: 1000, reason: 'Onboarding: login credentials missing, skip login' },
          postconditions: [{ type: 'no_console_errors' }],
          assertions: [],
          onFailure: 'CONTINUE_WITH_WARNING',
        });
      }
    }

    // Step 3: navigate to allowedRoutes (if declared)
    if (config.allowedRoutes && config.allowedRoutes.length > 0) {
      for (const route of config.allowedRoutes) {
        const fullUrl = new URL(route, config.baseUrl).toString();
        steps.push({
          id: `ONB-RT-${route.replace(/[^a-zA-Z0-9]/g, '')}`,
          description: `Navigate to allowed route ${route}`,
          preconditions: [],
          action: { type: 'navigate', to: fullUrl, reason: `Onboarding: verify allowed route ${route}` },
          postconditions: [{ type: 'url_contains', value: route }],
          assertions: [{ type: 'no_console_errors' }],
          onFailure: 'CONTINUE_WITH_WARNING',
        });
      }
    }

    // Final step: verify app surface loaded
    steps.push({
      id: `ONB-${String(steps.length + 1).padStart(3, '0')}`,
      description: 'Verify page loaded without console errors',
      preconditions: [],
      action: { type: 'waitForStable', timeoutMs: 3000, reason: 'Onboarding: wait for app surface to stabilize' },
      postconditions: [{ type: 'no_console_errors' }],
      assertions: [{ type: 'url_contains', value: new URL(config.baseUrl).hostname }],
      onFailure: 'BLOCK',
    });

    return {
      schemaVersion: 'execution-plan.v1',
      planId: 'onboarding-smoke',
      version: 1,
      goal: 'Onboarding smoke: validate the agent can operate the target app',
      mode: 'PLAN_AND_EXECUTE',
      runtime: {
        maxAttemptsPerStep: 2,
        maxReplansPerScenario: 0,
        destructiveActionPolicy: 'BLOCK',
      },
      steps,
      assertions: [],
    };
  }

  private toLocator(value: string | LocatorDescriptor): LocatorDescriptor {
    if (typeof value === 'string') {
      return { strategy: 'text', text: value };
    }
    return value;
  }
}
