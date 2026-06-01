import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiffMemoryExtractorService } from '../src/application/services/diff-memory-extractor.service.js';
import type { LlmProviderPort } from '../src/application/ports/llm-provider.port.js';

const mockLlm: LlmProviderPort = {
  complete: vi.fn(),
};

// Mock fs/promises so loadSystemPrompt succeeds without reading real file
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('You are a QA memory generator.'),
}));

describe('DiffMemoryExtractorService', () => {
  let service: DiffMemoryExtractorService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROQ_DELAY_MS = '0';
    service = new DiffMemoryExtractorService(mockLlm);
  });

  describe('groupFilesByCategory', () => {
    it('groups test files correctly', () => {
      const files = ['src/components/button.test.tsx', 'src/utils/helper.spec.ts', 'src/app/page.tsx'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.get('tests')).toContain('src/components/button.test.tsx');
      expect(groups.get('tests')).toContain('src/utils/helper.spec.ts');
      expect(groups.get('routes')).toContain('src/app/page.tsx');
    });

    it('groups route files (page.tsx in app/)', () => {
      const files = ['src/app/page.tsx', 'src/app/dashboard/page.tsx', 'src/app/settings/page.jsx'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.get('routes')).toContain('src/app/page.tsx');
      expect(groups.get('routes')).toContain('src/app/dashboard/page.tsx');
      expect(groups.get('routes')).toContain('src/app/settings/page.jsx');
    });

    it('groups API/service files', () => {
      const files = ['src/api/users.ts', 'src/services/auth.ts', 'src/infra/db.ts'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.get('api_services')).toContain('src/api/users.ts');
      expect(groups.get('api_services')).toContain('src/services/auth.ts');
      expect(groups.get('api_services')).toContain('src/infra/db.ts');
    });

    it('groups component files', () => {
      const files = ['src/components/Button.tsx', 'src/ui/Card.tsx', 'src/features/Header.tsx'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.get('components')).toContain('src/components/Button.tsx');
      expect(groups.get('components')).toContain('src/ui/Card.tsx');
      expect(groups.get('components')).toContain('src/features/Header.tsx');
    });

    it('groups hooks and utils', () => {
      const files = ['src/hooks/useAuth.ts', 'src/utils/format.ts', 'src/lib/helpers.ts'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.get('hooks_utils')).toContain('src/hooks/useAuth.ts');
      expect(groups.get('hooks_utils')).toContain('src/utils/format.ts');
      expect(groups.get('hooks_utils')).toContain('src/lib/helpers.ts');
    });

    it('puts non-matching source files in other', () => {
      const files = ['src/types/user.ts', 'README.md'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.get('other')).toContain('src/types/user.ts');
      expect(groups.has('other')).toBe(true);
    });

    it('removes empty groups', () => {
      const files = ['src/app/page.tsx'];
      // @ts-expect-error accessing private method for testing
      const groups = service.groupFilesByCategory(files);
      expect(groups.has('tests')).toBe(false);
      expect(groups.has('components')).toBe(false);
      expect(groups.has('routes')).toBe(true);
    });
  });

  describe('parseMarkdownChunks', () => {
    it('parses valid markdown chunks', () => {
      const markdown = `## Home Page\n\n<!-- type: route | id: HOME-PAGE -->\n- **URL**: /home\n- **Description**: Main landing page\n\n## Login Form\n\n<!-- type: semantic_locator | id: LOGIN-FORM -->\n- **Selector**: #login\n`;
      // @ts-expect-error accessing private method for testing
      const chunks = service.parseMarkdownChunks(markdown);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].id).toBe('HOME-PAGE');
      expect(chunks[0].type).toBe('route');
      expect(chunks[0].title).toBe('Home Page');
      expect(chunks[1].id).toBe('LOGIN-FORM');
      expect(chunks[1].type).toBe('semantic_locator');
    });

    it('ignores sections without metadata comment', () => {
      const markdown = `## Bad Section\n\nNo metadata here.\n\n## Good Section\n\n<!-- type: route | id: GOOD -->\nContent here.\n`;
      // @ts-expect-error accessing private method for testing
      const chunks = service.parseMarkdownChunks(markdown);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].id).toBe('GOOD');
    });

    it('ignores sections without title', () => {
      const markdown = `\n\n<!-- type: route | id: NO-TITLE -->\nContent.\n`;
      // @ts-expect-error accessing private method for testing
      const chunks = service.parseMarkdownChunks(markdown);
      expect(chunks).toHaveLength(0);
    });

    it('returns empty array for empty markdown', () => {
      // @ts-expect-error accessing private method for testing
      const chunks = service.parseMarkdownChunks('');
      expect(chunks).toHaveLength(0);
    });

    it('returns empty array for markdown without headers', () => {
      // @ts-expect-error accessing private method for testing
      const chunks = service.parseMarkdownChunks('Just some text without headers.');
      expect(chunks).toHaveLength(0);
    });
  });

  describe('pickRepresentativeFiles', () => {
    it('picks up to count files distributed across directories', () => {
      const files = [
        'src/app/page.tsx',
        'src/app/layout.tsx',
        'src/components/Button.tsx',
        'src/components/Card.tsx',
        'src/hooks/useAuth.ts',
        'src/utils/format.ts',
      ];
      // @ts-expect-error accessing private method for testing
      const picked = service.pickRepresentativeFiles(files, 4);
      expect(picked).toHaveLength(4);
      // Should pick from different dirs first
      const dirs = picked.map((f: string) => f.split('/').slice(0, 2).join('/'));
      expect(new Set(dirs).size).toBeGreaterThanOrEqual(2);
    });

    it('returns all files when count exceeds file count', () => {
      const files = ['a.ts', 'b.ts'];
      // @ts-expect-error accessing private method for testing
      const picked = service.pickRepresentativeFiles(files, 10);
      expect(picked).toHaveLength(2);
    });

    it('returns empty array for empty input', () => {
      // @ts-expect-error accessing private method for testing
      const picked = service.pickRepresentativeFiles([], 5);
      expect(picked).toHaveLength(0);
    });

    it('round-robins across directories when count is high', () => {
      const files = [
        'src/app/page.tsx',
        'src/app/layout.tsx',
        'src/app/error.tsx',
        'src/components/Button.tsx',
        'src/components/Card.tsx',
      ];
      // @ts-expect-error accessing private method for testing
      const picked = service.pickRepresentativeFiles(files, 4);
      // Should pick page.tsx, components/Button.tsx, layout.tsx, components/Card.tsx
      expect(picked).toContain('src/app/page.tsx');
      expect(picked).toContain('src/components/Button.tsx');
    });
  });

  describe('extract', () => {
    it('falls back to allChunks when final consolidation returns empty', async () => {
      const mockComplete = vi.fn()
        .mockResolvedValueOnce({ content: '## Route\n\n<!-- type: route | id: R-001 -->\nContent', model: 'test' }) // group
        .mockResolvedValueOnce({ content: '', model: 'test' }); // consolidation empty

      vi.mocked(mockLlm.complete).mockImplementation(mockComplete);

      const input = {
        projectPath: '/tmp/project',
        changedFiles: ['src/app/page.tsx'],
      };

      const result = await service.extract(input);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('R-001');
    });

    it('returns final chunks when consolidation produces results', async () => {
      const mockComplete = vi.fn()
        .mockResolvedValueOnce({ content: '## Route\n\n<!-- type: route | id: R-001 -->\n', model: 'test' })
        .mockResolvedValueOnce({ content: '## Route\n\n<!-- type: route | id: R-001-CONSOLIDATED -->\n', model: 'test' });

      vi.mocked(mockLlm.complete).mockImplementation(mockComplete);

      const input = {
        projectPath: '/tmp/project',
        changedFiles: ['src/app/page.tsx'],
      };

      const result = await service.extract(input);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('R-001-CONSOLIDATED');
    });

    it('processes multiple file groups', async () => {
      const mockComplete = vi.fn()
        .mockResolvedValueOnce({ content: '## Route\n\n<!-- type: route | id: R-001 -->\n', model: 'test' })
        .mockResolvedValueOnce({ content: '## Component\n\n<!-- type: component | id: C-001 -->\n', model: 'test' })
        .mockResolvedValueOnce({ content: '', model: 'test' });

      vi.mocked(mockLlm.complete).mockImplementation(mockComplete);

      const input = {
        projectPath: '/tmp/project',
        changedFiles: ['src/app/page.tsx', 'src/components/Button.tsx'],
      };

      const result = await service.extract(input);
      expect(result).toHaveLength(2);
    });

    it('uses default model when not provided', async () => {
      vi.mocked(mockLlm.complete).mockResolvedValue({ content: '', model: 'test' });

      const input = {
        projectPath: '/tmp/project',
        changedFiles: ['src/app/page.tsx'],
      };

      await service.extract(input);
      expect(mockLlm.complete).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.3-70b-versatile' }),
      );
    });

    it('uses custom model when provided', async () => {
      vi.mocked(mockLlm.complete).mockResolvedValue({ content: '', model: 'test' });

      const input = {
        projectPath: '/tmp/project',
        changedFiles: ['src/app/page.tsx'],
        llmModel: 'custom-model',
      };

      await service.extract(input);
      expect(mockLlm.complete).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'custom-model' }),
      );
    });
  });
});
