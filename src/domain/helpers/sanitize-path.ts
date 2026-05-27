const HOME_PREFIX_PATTERN = /^\/(?:home|Users)\/[^/]+\//;

export function sanitizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();
  if (!normalized) {
    return normalized;
  }

  const hadHomePrefix = HOME_PREFIX_PATTERN.test(normalized);
  let working = normalized.replace(HOME_PREFIX_PATTERN, '');
  const isAbsolute = working.startsWith('/') || hadHomePrefix;
  if (hadHomePrefix && !working.startsWith('/')) {
    working = `/${working}`;
  }

  const segments = working.split('/').filter(Boolean);

  if (segments.length <= 2) {
    const body = segments.join('/');
    if (hadHomePrefix) {
      return `<redacted>/${body}`;
    }
    return isAbsolute ? `/${body}` : body;
  }

  const tail = segments.slice(-2).join('/');
  if (hadHomePrefix) {
    return `<redacted>/.../${tail}`;
  }
  return isAbsolute ? `/.../${tail}` : `.../${tail}`;
}
