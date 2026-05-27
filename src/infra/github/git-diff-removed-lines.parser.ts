import { DiffLineSchema, type DiffLine } from '../../domain/schemas/diff-line.schema.js';
import { HUNK_HEADER_PATTERN, isFileMetadataLine } from './git-diff.parser.shared.js';

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
