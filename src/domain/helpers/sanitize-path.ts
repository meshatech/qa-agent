import { homedir } from 'node:os';

const STATIC_HOME_PREFIX_PATTERNS = [
  /^\/(?:home|Users)\/[^/]+\//,
  /^[A-Za-z]:\/Users\/[^/]+\//,
];

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

function resolveHomeDirectory(): string | undefined {
  const home = homedir()?.replace(/\\/g, '/').replace(/\/+$/, '');
  return home || undefined;
}

function stripStaticHomePrefix(normalized: string): { stripped: string; hadHomePrefix: boolean } {
  for (const pattern of STATIC_HOME_PREFIX_PATTERNS) {
    if (pattern.test(normalized)) {
      return { stripped: normalized.replace(pattern, ''), hadHomePrefix: true };
    }
  }
  return { stripped: normalized, hadHomePrefix: false };
}

function stripProcessHomePrefix(normalized: string, home?: string): { stripped: string; hadHomePrefix: boolean } {
  const resolvedHome = home ?? resolveHomeDirectory();
  if (!resolvedHome) {
    return { stripped: normalized, hadHomePrefix: false };
  }

  const prefix = `${resolvedHome}/`;
  if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
    return {
      stripped: normalized.slice(resolvedHome.length),
      hadHomePrefix: true,
    };
  }

  return { stripped: normalized, hadHomePrefix: false };
}

export function sanitizePath(path: string, homeDir?: string): string {
  const normalized = normalizePathSeparators(path);
  if (!normalized) {
    return normalized;
  }

  let hadHomePrefix = false;
  let working = normalized;

  const staticStrip = stripStaticHomePrefix(working);
  if (staticStrip.hadHomePrefix) {
    hadHomePrefix = true;
    working = staticStrip.stripped;
  } else {
    const processStrip = stripProcessHomePrefix(working, homeDir);
    if (processStrip.hadHomePrefix) {
      hadHomePrefix = true;
      working = processStrip.stripped;
    }
  }

  const isAbsolute =
    working.startsWith('/') || /^[A-Za-z]:\//.test(working) || hadHomePrefix;
  if (hadHomePrefix && !working.startsWith('/') && !/^[A-Za-z]:\//.test(working)) {
    working = `/${working.replace(/^\/+/, '')}`;
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
