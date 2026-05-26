const ACCEPTANCE_CRITERIA_SECTION =
  /^(crit[eé]rios de aceite|acceptance criteria)\s*:?\s*$/i;

const KNOWN_SECTION_HEADERS =
  /^(descri[cç][aã]o|componente\s*\/?\s*servi[cç]o|entrada esperada|sa[ií]da esperada|casos de uso|uso permitido|uso proibido|crit[eé]rios de aceite|acceptance criteria)\s*:?\s*$/i;

const CHECKBOX_ITEM = /^[-*]\s*\[[ xX]\]\s*(.+)$/;
const BULLET_ITEM = /^[-*]\s+(.+)$/;
const NUMBERED_ITEM = /^\d+[.)]\s+(.+)$/;

export function extractClickUpAcceptanceCriteria(description: string): string[] {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
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

    if (KNOWN_SECTION_HEADERS.test(trimmed) && !ACCEPTANCE_CRITERIA_SECTION.test(trimmed)) {
      break;
    }

    const normalized = normalizeCriterionLine(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    criteria.push(normalized);
  }

  return criteria;
}

function normalizeCriterionLine(line: string): string | null {
  const checkboxMatch = line.match(CHECKBOX_ITEM);
  if (checkboxMatch?.[1]) {
    return normalizeText(checkboxMatch[1]);
  }

  const bulletMatch = line.match(BULLET_ITEM);
  if (bulletMatch?.[1]) {
    return normalizeText(bulletMatch[1]);
  }

  const numberedMatch = line.match(NUMBERED_ITEM);
  if (numberedMatch?.[1]) {
    return normalizeText(numberedMatch[1]);
  }

  return normalizeText(line);
}

function normalizeText(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}
