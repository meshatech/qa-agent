import {
  isClickUpSectionHeader,
  normalizeClickUpDescriptionText,
  splitClickUpDescriptionLines,
} from './clickup-description-sections.js';

const EXPECTED_RESULT_SECTION = /^(resultado esperado|expected result)\s*:?\s*$/i;
const ACTUAL_RESULT_SECTION =
  /^(resultado obtido|resultado atual|actual result)\s*:?\s*$/i;

export interface ClickUpBugResults {
  expectedResult: string | null;
  actualResult: string | null;
}

export function extractClickUpBugResults(description: string): ClickUpBugResults {
  return {
    expectedResult: extractSectionText(description, EXPECTED_RESULT_SECTION),
    actualResult: extractSectionText(description, ACTUAL_RESULT_SECTION),
  };
}

function extractSectionText(description: string, sectionPattern: RegExp): string | null {
  const lines = splitClickUpDescriptionLines(description);
  const sectionStart = lines.findIndex((line) => sectionPattern.test(line.trim()));

  if (sectionStart === -1) {
    return null;
  }

  const contentLines: string[] = [];

  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed) {
      continue;
    }

    if (isClickUpSectionHeader(trimmed, sectionPattern)) {
      break;
    }

    contentLines.push(trimmed);
  }

  if (contentLines.length === 0) {
    return null;
  }

  const normalized = contentLines
    .map((line) => normalizeClickUpDescriptionText(line))
    .filter((line): line is string => line !== null)
    .join(' ');

  return normalized.length > 0 ? normalized : null;
}
