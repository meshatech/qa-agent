export function normalizeComponentName(name: string): string {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[-_.]/g, '').trim();
}

export function componentMatches(affectedComponent: string, scenarioComponent: string): boolean {
  const normalizedAffected = normalizeComponentName(affectedComponent);
  const normalizedScenario = normalizeComponentName(scenarioComponent);

  if (!normalizedAffected || !normalizedScenario) return false;

  return normalizedScenario === normalizedAffected;
}
