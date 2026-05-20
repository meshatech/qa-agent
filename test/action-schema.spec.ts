import { describe, expect, it } from 'vitest';
import { QaActionEnvelopeSchema } from '../src/domain/schemas/action.schema.js';

describe('QaActionEnvelopeSchema', () => {
  it('accepts action.v1 envelope', () => {
    expect(QaActionEnvelopeSchema.parse({
      schemaVersion: 'action.v1',
      observationId: 'obs_1',
      thought_summary: 'ok',
      action: { type: 'press', key: 'Escape', reason: 'close' },
      expected_after_action: { type: 'text_visible', text: 'Home' },
      fallback_action: { type: 'press', key: 'Escape', reason: 'fallback' },
      confidence: 0.5,
    }).schemaVersion).toBe('action.v1');
  });
});
