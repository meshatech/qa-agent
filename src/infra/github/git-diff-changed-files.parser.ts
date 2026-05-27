import {
  ChangedFileWithoutKindSchema,
  type ChangedFileStatus,
  type ChangedFileWithoutKind,
} from '../../domain/schemas/changed-file.schema.js';
import { DiffLineSchema, type DiffLine } from '../../domain/schemas/diff-line.schema.js';
import { HUNK_HEADER_PATTERN, isFileMetadataLine } from './git-diff.parser.shared.js';

const DIFF_GIT_PATTERN = /^diff --git a\/(.+) b\/(.+)$/;

interface FileBuildState {
  oldPath: string;
  newPath: string;
  oldIsNull: boolean;
  newIsNull: boolean;
  isBinary: boolean;
  positiveLines: DiffLine[];
  negativeLines: DiffLine[];
  contextLines: DiffLine[];
}

function createFileBuildState(oldPath: string, newPath: string): FileBuildState {
  return {
    oldPath,
    newPath,
    oldIsNull: false,
    newIsNull: false,
    isBinary: false,
    positiveLines: [],
    negativeLines: [],
    contextLines: [],
  };
}

function resolveFileStatus(state: FileBuildState): ChangedFileStatus {
  if (state.oldIsNull) {
    return 'added';
  }
  if (state.newIsNull) {
    return 'removed';
  }
  return 'modified';
}

function resolveFilePath(state: FileBuildState, status: ChangedFileStatus): string {
  return status === 'removed' ? state.oldPath : state.newPath;
}

function finalizeFile(state: FileBuildState): ChangedFileWithoutKind {
  const status = resolveFileStatus(state);
  return ChangedFileWithoutKindSchema.parse({
    path: resolveFilePath(state, status),
    status,
    positiveLines: state.positiveLines,
    negativeLines: state.negativeLines,
    contextLines: state.contextLines,
  });
}

export function parseGitDiffChangedFiles(rawDiff: string): ChangedFileWithoutKind[] {
  if (rawDiff === '') {
    return [];
  }

  const changedFiles: ChangedFileWithoutKind[] = [];
  let currentFile: FileBuildState | undefined;
  let oldLineNumber: number | undefined;
  let newLineNumber: number | undefined;

  const flushCurrentFile = (): void => {
    if (currentFile === undefined) {
      return;
    }
    changedFiles.push(finalizeFile(currentFile));
    currentFile = undefined;
    oldLineNumber = undefined;
    newLineNumber = undefined;
  };

  for (const line of rawDiff.split('\n')) {
    const diffGitMatch = DIFF_GIT_PATTERN.exec(line);
    if (diffGitMatch) {
      flushCurrentFile();
      currentFile = createFileBuildState(diffGitMatch[1] ?? '', diffGitMatch[2] ?? '');
      continue;
    }

    if (currentFile === undefined) {
      continue;
    }

    if (line.startsWith('--- /dev/null')) {
      currentFile.oldIsNull = true;
      continue;
    }

    if (line.startsWith('+++ /dev/null')) {
      currentFile.newIsNull = true;
      continue;
    }

    if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      currentFile.isBinary = true;
      continue;
    }

    if (isFileMetadataLine(line)) {
      continue;
    }

    if (HUNK_HEADER_PATTERN.test(line)) {
      const match = HUNK_HEADER_PATTERN.exec(line);
      oldLineNumber = match ? Number(match[1]) : undefined;
      newLineNumber = match ? Number(match[2]) : undefined;
      continue;
    }

    if (oldLineNumber === undefined || newLineNumber === undefined) {
      continue;
    }

    if (line.startsWith('+')) {
      currentFile.positiveLines.push(
        DiffLineSchema.parse({
          type: 'added',
          lineNumber: newLineNumber,
          content: line.slice(1),
        }),
      );
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith('-')) {
      currentFile.negativeLines.push(
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
      currentFile.contextLines.push(
        DiffLineSchema.parse({
          type: 'context',
          lineNumber: newLineNumber,
          content: line.slice(1),
        }),
      );
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    if (line.startsWith('\\')) {
      continue;
    }
  }

  flushCurrentFile();
  return changedFiles;
}
