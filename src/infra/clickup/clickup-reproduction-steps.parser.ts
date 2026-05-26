const REPRODUCTION_STEPS_SECTION =
  /^(passos para reproduzir|passos de reprodu[cç][aã]o|steps to reproduce)\s*:?\s*$/i;

const KNOWN_SECTION_HEADERS =
  /^(descri[cç][aã]o|componente\s*\/?\s*servi[cç]o|entrada esperada|sa[ií]da esperada|casos de uso|uso permitido|uso proibido|crit[eé]rios de aceite|acceptance criteria|passos para reproduzir|passos de reprodu[cç][aã]o|steps to reproduce|resultado esperado|resultado obtido|expected result|actual result)\s*:?\s*$/i;

const CHECKBOX_ITEM = /^[-*]\s*\[[ xX]\]\s*(.+)$/;
const BULLET_ITEM = /^[-*]\s+(.+)$/;
const NUMBERED_ITEM = /^\d+[.)]\s+(.+)$/;

export function extractClickUpReproductionSteps(description: string): string[] {
  const lines = description.replace(/\r\n/g, '\n').split('\n');
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

    if (KNOWN_SECTION_HEADERS.test(trimmed) && !REPRODUCTION_STEPS_SECTION.test(trimmed)) {
      break;
    }

    const normalized = normalizeStepLine(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    steps.push(normalized);
  }

  return steps;
}

function normalizeStepLine(line: string): string | null {
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
