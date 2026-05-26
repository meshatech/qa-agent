import {
  isClickUpSectionHeader,
  normalizeClickUpListLine,
  splitClickUpDescriptionLines,
} from './clickup-description-sections.js';

const REPRODUCTION_STEPS_SECTION =
  /^(passos para reproduzir|passos de reprodu[cç][aã]o|steps to reproduce)\s*:?\s*$/i;

export function extractClickUpReproductionSteps(description: string): string[] {
  const lines = splitClickUpDescriptionLines(description);
  const sectionStart = lines.findIndex((line) => REPRODUCTION_STEPS_SECTION.test(line.trim()));

  if (sectionStart === -1) {
    return [];
  }

  const steps: string[] = [];
  const seen = new Set<string>();

  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed) {
      continue;
    }

    if (isClickUpSectionHeader(trimmed, REPRODUCTION_STEPS_SECTION)) {
      break;
    }

    const normalized = normalizeClickUpListLine(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    steps.push(normalized);
  }

  return steps;
}
