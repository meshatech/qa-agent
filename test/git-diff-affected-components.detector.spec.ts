import { describe, expect, it } from 'vitest';
import {
  extractComponentFromPath,
  detectAffectedComponents,
} from '../src/infra/github/git-diff-affected-components.detector.js';
import type { ChangedFile } from '../src/domain/schemas/changed-file.schema.js';

function makeFile(path: string, kind: ChangedFile['kind']): ChangedFile {
  return {
    path,
    status: 'modified',
    kind,
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

describe('extractComponentFromPath', () => {
  it('extracts component from common path', () => {
    expect(extractComponentFromPath('src/components/LoginForm.tsx')).toBe('LoginForm');
  });

  it('extracts component from feature path', () => {
    expect(extractComponentFromPath('src/features/account/AccountMenu.tsx')).toBe('AccountMenu');
  });

  it('removes .spec suffix', () => {
    expect(extractComponentFromPath('src/components/LoginForm.spec.tsx')).toBe('LoginForm');
  });

  it('removes .test suffix', () => {
    expect(extractComponentFromPath('src/components/LoginForm.test.ts')).toBe('LoginForm');
  });

  it('removes .stories suffix', () => {
    expect(extractComponentFromPath('src/components/Button.stories.tsx')).toBe('Button');
  });

  it('removes .styles suffix', () => {
    expect(extractComponentFromPath('src/components/Button.styles.ts')).toBe('Button');
  });

  it('removes .style suffix', () => {
    expect(extractComponentFromPath('src/components/Card.style.ts')).toBe('Card');
  });

  it('handles file without suffix', () => {
    expect(extractComponentFromPath('src/components/Header.vue')).toBe('Header');
  });

  it('returns undefined for empty basename', () => {
    expect(extractComponentFromPath('')).toBeUndefined();
  });
});

describe('detectAffectedComponents', () => {
  it('detects components from modified files', () => {
    const files = [
      makeFile('src/components/LoginForm.tsx', 'other'),
      makeFile('src/features/account/AccountMenu.tsx', 'other'),
    ];

    const result = detectAffectedComponents(files);

    expect(result).toEqual(['accountmenu', 'loginform']);
  });

  it('ignores test files', () => {
    const files = [
      makeFile('src/components/LoginForm.tsx', 'other'),
      makeFile('src/components/LoginForm.spec.tsx', 'test'),
    ];

    const result = detectAffectedComponents(files);

    expect(result).toEqual(['loginform']);
  });

  it('ignores infra files', () => {
    const files = [
      makeFile('src/components/LoginForm.tsx', 'other'),
      makeFile('src/infra/docker/Dockerfile', 'infra'),
    ];

    const result = detectAffectedComponents(files);

    expect(result).toEqual(['loginform']);
  });

  it('ignores docs files', () => {
    const files = [
      makeFile('src/components/LoginForm.tsx', 'other'),
      makeFile('docs/README.md', 'docs'),
    ];

    const result = detectAffectedComponents(files);

    expect(result).toEqual(['loginform']);
  });

  it('deduplicates components', () => {
    const files = [
      makeFile('src/components/LoginForm.tsx', 'other'),
      makeFile('src/features/LoginForm.vue', 'other'),
    ];

    const result = detectAffectedComponents(files);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe('loginform');
  });

  it('returns empty array when no components found', () => {
    const files = [
      makeFile('src/infra/config.ts', 'infra'),
      makeFile('docs/README.md', 'docs'),
    ];

    const result = detectAffectedComponents(files);

    expect(result).toEqual([]);
  });
});
