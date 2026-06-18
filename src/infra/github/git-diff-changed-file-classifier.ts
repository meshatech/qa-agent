import {
  ChangedFileSchema,
  type ChangedFile,
  type ChangedFileKind,
  type ChangedFileWithoutKind,
} from '../../domain/schemas/changed-file.schema.js';

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function classifyChangedFileKind(path: string): ChangedFileKind {
  const normalized = normalizePath(path);

  if (
    normalized.startsWith('test/') ||
    normalized.includes('/test/') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.test.ts')
  ) {
    return 'test';
  }

  if (
    normalized.startsWith('src/domain/schemas/') ||
    normalized.includes('/schemas/') ||
    normalized.endsWith('.schema.ts')
  ) {
    return 'schema';
  }

  if (
    normalized.startsWith('src/routes/') ||
    normalized.startsWith('src/pages/') ||
    normalized.includes('/routes/') ||
    normalized.includes('/pages/') ||
    // Next.js App Router: app/**/{page,route,layout}.{tsx,ts,jsx,js}
    /(?:^|\/)app\/(?:.*\/)?(?:page|route|layout)\.(?:tsx?|jsx?)$/.test(normalized)
  ) {
    return 'route';
  }

  if (normalized.startsWith('src/infra/')) {
    return 'infra';
  }

  if (normalized.startsWith('doc/') || normalized.startsWith('docs/') || normalized.endsWith('.md')) {
    return 'docs';
  }

  return 'other';
}

export function classifyChangedFiles(files: ChangedFileWithoutKind[]): ChangedFile[] {
  return files.map((file) =>
    ChangedFileSchema.parse({
      ...file,
      kind: classifyChangedFileKind(file.path),
    }),
  );
}
