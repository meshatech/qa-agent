import {
  isClickUpSectionHeader,
  normalizeClickUpListLine,
  splitClickUpDescriptionLines,
} from './clickup-description-sections.js';

const ACCEPTANCE_CRITERIA_SECTION =
  /^(crit[eé]rios de aceite|acceptance criteria)\s*:?\s*$/i;

export function extractClickUpAcceptanceCriteria(description: string): string[] {
  const lines = splitClickUpDescriptionLines(description);
  const sectionStart = lines.findIndex((line) => ACCEPTANCE_CRITERIA_SECTION.test(line.trim()));

  if (sectionStart === -1) {
    return [];
  }

  const criteria: string[] = [];
  const seen = new Set<string>();

  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed) {
      continue;
    }

    if (isClickUpSectionHeader(trimmed, ACCEPTANCE_CRITERIA_SECTION)) {
      break;
    }

    const normalized = normalizeClickUpListLine(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    criteria.push(normalized);
  }

  return criteria;
}
