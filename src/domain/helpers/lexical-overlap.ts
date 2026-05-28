export function tokenize(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  return new Set(tokens);
}

export function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count++;
  }
  return count;
}

export function computeOverlapScore(query: string, target: string): number {
  const queryTokens = tokenize(query);
  const targetTokens = tokenize(target);

  if (queryTokens.size === 0 || targetTokens.size === 0) {
    return 0;
  }

  const overlap = intersectionSize(queryTokens, targetTokens);
  const unionSize = new Set([...queryTokens, ...targetTokens]).size;

  return unionSize > 0 ? overlap / unionSize : 0;
}
