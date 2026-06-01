import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryChunkRenderer } from '../src/application/services/memory-chunk-renderer.service.js';
import type { LearningCandidate } from '../src/domain/schemas/learning-candidate.schema.js';

describe('MemoryChunkRenderer', () => {
  const renderer = new MemoryChunkRenderer();

  beforeEach(() => {
    // no-op
  });

  const makeCandidate = (overrides: Omit<Partial<LearningCandidate>, 'type'> & { id: string; type: string }): LearningCandidate & { type: string } =>
    ({
      id: overrides.id,
      type: overrides.type,
      runId: overrides.runId ?? 'run-001',
      description: overrides.description ?? 'Test description',
      content: overrides.content ?? 'Test content',
      source: overrides.source ?? 'confirmed',
      confidence: overrides.confidence ?? 0.8,
      risk: overrides.risk,
      generatedAt: overrides.generatedAt ?? '2024-05-29T10:00:00Z',
      metadata: overrides.metadata ?? {},
    } as LearningCandidate);

  describe('render', () => {
    it('renders semantic_locator chunk correctly', () => {
      const candidate = makeCandidate({
        id: 'lc-001',
        type: 'semantic_locator',
        description: 'Login button locator',
        content: 'Button with text "Login"',
        source: 'confirmed',
        confidence: 0.9,
        risk: 'low',
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).toContain('## Login button locator');
      expect(chunk).toContain('<!-- type: semantic_locator | id: LC-001 -->');
      expect(chunk).toContain('- **Description**: Login button locator');
      expect(chunk).toContain('- **Content**: Button with text "Login"');
      expect(chunk).toContain('- **Source**: confirmed');
      expect(chunk).toContain('- **Confidence**: 0.9');
      expect(chunk).toContain('- **Risk**: low');
    });

    it('renders route_mapping chunk correctly', () => {
      const candidate = makeCandidate({
        id: 'lc-route-001',
        type: 'route_mapping',
        description: 'Home page route',
        content: '/home',
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).toContain('<!-- type: route | id: LC-ROUTE-001 -->');
    });

    it('renders component_behavior chunk correctly', () => {
      const candidate = makeCandidate({
        id: 'lc-behavior-001',
        type: 'component_behavior',
        description: 'Modal close behavior',
        content: 'Press ESC to close',
        risk: 'medium',
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).toContain('<!-- type: known_issue | id: LC-BEHAVIOR-001 -->');
      expect(chunk).toContain('- **Risk**: medium');
    });

    it('renders recovery_pattern chunk correctly', () => {
      const candidate = makeCandidate({
        id: 'lc-recovery-001',
        type: 'recovery_pattern',
        description: 'Retry on timeout',
        content: 'Wait 2s then retry',
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).toContain('<!-- type: runtime_learning | id: LC-RECOVERY-001 -->');
    });

    it('renders gap chunk correctly', () => {
      const candidate = makeCandidate({
        id: 'lc-gap-001',
        type: 'gap',
        description: 'Missing locator for submit',
        content: 'No semantic locator found',
        risk: 'high',
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).toContain('<!-- type: known_issue | id: LC-GAP-001 -->');
      expect(chunk).toContain('- **Risk**: high');
    });

    it('returns null for unknown type', () => {
      const candidate = makeCandidate({
        id: 'lc-unknown-001',
        type: 'unknown_type',
        description: 'Unknown',
        content: 'Unknown content',
      });
      expect(renderer.render(candidate)).toBeNull();
    });

    it('sanitizes IDs with special characters', () => {
      const candidate = makeCandidate({
        id: 'lc@test#123',
        type: 'semantic_locator',
        description: 'Test',
        content: 'Test content',
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).toContain('id: LC-TEST-123');
    });

    it('does not include risk line when risk is absent', () => {
      const candidate = makeCandidate({
        id: 'lc-no-risk',
        type: 'semantic_locator',
        description: 'Test',
        content: 'Test content',
        risk: undefined,
      });
      const chunk = renderer.render(candidate);
      expect(chunk).not.toBeNull();
      expect(chunk).not.toContain('- **Risk**');
    });
  });

  describe('renderAll', () => {
    it('renders multiple candidates and accumulates warnings for unknown types', () => {
      const candidates = [
        makeCandidate({ id: 'lc-001', type: 'semantic_locator', description: 'A', content: 'A content' }),
        makeCandidate({ id: 'lc-002', type: 'unknown_type', description: 'B', content: 'B content' }),
        makeCandidate({ id: 'lc-003', type: 'route_mapping', description: 'C', content: 'C content' }),
      ];
      const result = renderer.renderAll(candidates);
      expect(result.chunks).toHaveLength(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('unknown_type');
      expect(result.warnings[0]).toContain('lc-002');
    });

    it('returns empty arrays when input is empty', () => {
      const result = renderer.renderAll([]);
      expect(result.chunks).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
