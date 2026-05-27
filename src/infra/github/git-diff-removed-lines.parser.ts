import { DiffLineSchema, type DiffLine } from '../../domain/schemas/diff-line.schema.js';

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function isFileMetadataLine(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch')
  );
}

export function parseGitDiffRemovedLines(rawDiff: string): DiffLine[] {
  if (rawDiff === '') {
    return [];
  }

  const removedLines: DiffLine[] = [];
  let oldLineNumber: number | undefined;

  for (const line of rawDiff.split('\n')) {
    if (HUNK_HEADER_PATTERN.test(line)) {
      const match = HUNK_HEADER_PATTERN.exec(line);
      oldLineNumber = match ? Number(match[1]) : undefined;
      continue;
    }

    if (oldLineNumber === undefined || isFileMetadataLine(line)) {
      continue;
    }

    if (line.startsWith('-')) {
      removedLines.push(
        DiffLineSchema.parse({
          type: 'removed',
          lineNumber: oldLineNumber,
          content: line.slice(1),
        }),
      );
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      oldLineNumber += 1;
      continue;
    }

    if (line.startsWith('+') || line.startsWith('\\')) {
      continue;
    }
  }

  return removedLines;
}
