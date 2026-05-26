const EXPECTED_RESULT_SECTION = /^(resultado esperado|expected result)\s*:?\s*$/i;
const ACTUAL_RESULT_SECTION =
  /^(resultado obtido|resultado atual|actual result)\s*:?\s*$/i;

const KNOWN_SECTION_HEADERS =
  /^(descri[cç][aã]o|componente\s*\/?\s*servi[cç]o|entrada esperada|sa[ií]da esperada|casos de uso|uso permitido|uso proibido|crit[eé]rios de aceite|acceptance criteria|passos para reproduzir|passos de reprodu[cç][aã]o|steps to reproduce|resultado esperado|resultado obtido|resultado atual|expected result|actual result)\s*:?\s*$/i;

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
  const lines = description.replace(/\r\n/g, '\n').split('\n');
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

    if (KNOWN_SECTION_HEADERS.test(trimmed) && !sectionPattern.test(trimmed)) {
      break;
    }

    contentLines.push(trimmed);
  }

  if (contentLines.length === 0) {
    return null;
  }

  const normalized = contentLines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

  return normalized.length > 0 ? normalized : null;
}
