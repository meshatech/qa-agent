import type { ChangedFile, ChangedFileKind } from '../../domain/schemas/changed-file.schema.js';

const TECHNICAL_SUFFIXES = ['.spec', '.test', '.stories', '.style', '.styles'];
const IGNORED_KINDS: ChangedFileKind[] = ['test', 'infra', 'docs'];

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function removeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function removeTechnicalSuffixes(name: string): string {
  let result = name;
  for (const suffix of TECHNICAL_SUFFIXES) {
    if (result.toLowerCase().endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
    }
  }
  return result;
}

export function extractComponentFromPath(path: string): string | undefined {
  const filename = basename(path);
  const withoutExt = removeExtension(filename);
  const componentName = removeTechnicalSuffixes(withoutExt);

  if (!componentName || componentName.length === 0) {
    return undefined;
  }

  return componentName;
}

function normalizeForComparison(name: string): string {
  return name.toLowerCase().replace(/[-_.]/g, '');
}

export function detectAffectedComponents(files: ChangedFile[]): string[] {
  const components = new Set<string>();

  for (const file of files) {
    if (IGNORED_KINDS.includes(file.kind)) {
      continue;
    }

    const component = extractComponentFromPath(file.path);
    if (!component) {
      continue;
    }

    components.add(normalizeForComparison(component));
  }

  return [...components].sort((a, b) => a.localeCompare(b));
}
