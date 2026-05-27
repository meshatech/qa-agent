import { DiffLineSchema, type DiffLine } from '../../domain/schemas/diff-line.schema.js';
import { HUNK_HEADER_PATTERN, isFileMetadataLine } from './git-diff.parser.shared.js';

export function parseGitDiffAddedLines(rawDiff: string): DiffLine[] {
  if (rawDiff === '') {
    return [];
  }

  const addedLines: DiffLine[] = [];
  let newLineNumber: number | undefined;

  for (const line of rawDiff.split('\n')) {
    if (HUNK_HEADER_PATTERN.test(line)) {
      const match = HUNK_HEADER_PATTERN.exec(line);
      newLineNumber = match ? Number(match[2]) : undefined;
      continue;
    }

    if (newLineNumber === undefined || isFileMetadataLine(line)) {
      continue;
    }

    if (line.startsWith('+')) {
      addedLines.push(
        DiffLineSchema.parse({
          type: 'added',
          lineNumber: newLineNumber,
          content: line.slice(1),
        }),
      );
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith('-') || line.startsWith('\\')) {
      continue;
    }
  }

  return addedLines;
}
