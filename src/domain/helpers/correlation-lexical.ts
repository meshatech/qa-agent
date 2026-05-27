export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9/\-_]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

export function pathTokens(path: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of path.split(/[/\\._-]+/)) {
    for (const token of tokenize(part)) {
      tokens.add(token);
    }
  }
  return tokens;
}

export function overlapScore(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) {
    return 0;
  }
  let matches = 0;
  for (const token of left) {
    if (right.has(token)) {
      matches += 1;
    }
  }
  return matches / left.size;
}
