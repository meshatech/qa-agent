import type { ChangedFile } from '../../domain/schemas/changed-file.schema.js';

const ROUTE_SEGMENT_PATTERN = /(?:^|\/)(?:routes|pages)\/(.+)$/;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toRoutePath(routeSegment: string): string {
  const withoutExtension = routeSegment.replace(/\.[^.]+$/, '');
  const collapsed = withoutExtension.replace(/\/?index$/, '');
  if (collapsed === '') {
    return '/';
  }
  return collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
}

export function extractRouteFromChangedFilePath(path: string): string | undefined {
  const normalized = normalizePath(path);
  const match = ROUTE_SEGMENT_PATTERN.exec(normalized);
  if (!match?.[1]) {
    return undefined;
  }

  return toRoutePath(match[1]);
}

export function detectAffectedRoutes(changedFiles: ChangedFile[]): string[] {
  const routes = new Set<string>();

  for (const file of changedFiles) {
    if (file.kind !== 'route') {
      continue;
    }

    const route = extractRouteFromChangedFilePath(file.path);
    if (route !== undefined) {
      routes.add(route);
    }
  }

  return [...routes].sort((left, right) => left.localeCompare(right));
}
