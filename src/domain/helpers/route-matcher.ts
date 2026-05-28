export function normalizeRoute(route: string): string {
  if (typeof route !== 'string') return '';

  let normalized = route.trim();

  // Remove query string
  const queryIndex = normalized.indexOf('?');
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex);

  // Remove hash
  const hashIndex = normalized.indexOf('#');
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex);

  // Normalize backslashes to forward slashes
  normalized = normalized.replace(/\\/g, '/');

  // Ensure leading slash
  if (!normalized.startsWith('/')) normalized = '/' + normalized;

  // Remove trailing slash, except for root
  if (normalized !== '/' && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function routeMatches(affectedRoute: string, scenarioRoute: string): boolean {
  const normalizedAffected = normalizeRoute(affectedRoute);
  const normalizedScenario = normalizeRoute(scenarioRoute);

  if (!normalizedAffected || !normalizedScenario) return false;

  // Exact match
  if (normalizedScenario === normalizedAffected) return true;

  // Prefix match: scenarioRoute is a child of affectedRoute
  const prefix = normalizedAffected + '/';
  if (normalizedScenario.startsWith(prefix)) return true;

  return false;
}
