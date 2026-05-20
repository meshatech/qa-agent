import { describe, expect, it } from 'vitest';
import { BugClassifierService } from '../src/application/services/bug-classifier.service.js';
import { RunConfigSchema } from '../src/domain/schemas/config.schema.js';

const config = RunConfigSchema.parse({ baseUrl: 'http://app.local', appDomains: ['app.local'], demand: { id: 'D', title: 'T', description: 'D' } });

describe('BugClassifierService', () => {
  it('classifies app 5xx as critical bug', () => {
    const c = new BugClassifierService().classify({ signalType: 'APP_NETWORK_5XX', message: '500', source: 'http://app.local/api', config });
    expect(c.isBug).toBe(true);
    expect(c.severity).toBe('CRITICAL');
  });

  it('classifies extension errors as noise', () => {
    const c = new BugClassifierService().classify({ signalType: 'APP_CONSOLE_EXCEPTION', message: 'x', source: 'chrome-extension://x', config });
    expect(c.isBug).toBe(false);
  });
});
