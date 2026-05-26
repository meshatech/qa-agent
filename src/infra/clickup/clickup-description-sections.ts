export const CLICKUP_KNOWN_SECTION_HEADERS =
  /^(descri[cç][aã]o|componente\s*\/?\s*servi[cç]o|entrada esperada|sa[ií]da esperada|casos de uso|uso permitido|uso proibido|crit[eé]rios de aceite|acceptance criteria|passos para reproduzir|passos de reprodu[cç][aã]o|steps to reproduce|resultado esperado|resultado obtido|resultado atual|expected result|actual result)\s*:?\s*$/i;

const CHECKBOX_ITEM = /^[-*]\s*\[[ xX]\]\s*(.+)$/;
const BULLET_ITEM = /^[-*]\s+(.+)$/;
const NUMBERED_ITEM = /^\d+[.)]\s+(.+)$/;

export function splitClickUpDescriptionLines(description: string): string[] {
  return description.replace(/\r\n/g, '\n').split('\n');
}

export function normalizeClickUpDescriptionText(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeClickUpListLine(line: string): string | null {
  const checkboxMatch = line.match(CHECKBOX_ITEM);
  if (checkboxMatch?.[1]) {
    return normalizeClickUpDescriptionText(checkboxMatch[1]);
  }

  const bulletMatch = line.match(BULLET_ITEM);
  if (bulletMatch?.[1]) {
    return normalizeClickUpDescriptionText(bulletMatch[1]);
  }

  const numberedMatch = line.match(NUMBERED_ITEM);
  if (numberedMatch?.[1]) {
    return normalizeClickUpDescriptionText(numberedMatch[1]);
  }

  return normalizeClickUpDescriptionText(line);
}

export function isClickUpSectionHeader(line: string, currentSection: RegExp): boolean {
  return CLICKUP_KNOWN_SECTION_HEADERS.test(line) && !currentSection.test(line);
}
