import type { ChangedFile } from '../../domain/schemas/changed-file.schema.js';

const SCHEMA_FILE_SUFFIX = '.schema.ts';

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function basename(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.]+$/, '');
}

export function extractSchemaIdentifierFromChangedFilePath(path: string): string | undefined {
  const normalized = normalizePath(path);
  if (normalized === '') {
    return undefined;
  }

  const fileName = basename(normalized);
  if (fileName.endsWith(SCHEMA_FILE_SUFFIX)) {
    return fileName.slice(0, -SCHEMA_FILE_SUFFIX.length);
  }

  return stripExtension(normalized);
}

export function detectAffectedSchemas(changedFiles: ChangedFile[]): string[] {
  const schemas = new Set<string>();

  for (const file of changedFiles) {
    if (file.kind !== 'schema') {
      continue;
    }

    const schemaId = extractSchemaIdentifierFromChangedFilePath(file.path);
    if (schemaId !== undefined) {
      schemas.add(schemaId);
    }
  }

  return [...schemas].sort((left, right) => left.localeCompare(right));
}
