import type { ChangedFile } from '../../domain/schemas/changed-file.schema.js';

const ROUTE_SEGMENT_PATTERN = /(?:^|\/)(?:routes|pages)\/(.+)$/;
// Next.js App Router: só arquivos de rota reais (page/route/layout); `routes/`
// e `pages/` têm precedência (ex.: app/routes/x.ts → /x, não /routes/x).
const APP_ROUTER_PATTERN = /(?:^|\/)app\/((?:.+\/)?(?:page|route|layout))\.(?:tsx?|jsx?)$/;

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toRoutePath(routeSegment: string): string {
  const withoutExtension = routeSegment.replace(/\.[^.]+$/, '');
  const segments = withoutExtension.split('/').filter(Boolean);
  // último segmento = arquivo de rota (App Router page/route/layout, ou index
  // do Pages Router) → remove pra obter o caminho navegável.
  const last = segments[segments.length - 1];
  if (last && /^(page|route|layout|index)$/.test(last)) {
    segments.pop();
  }
  // route groups do App Router, ex.: (dashboard), (auth) → não viram URL.
  const collapsed = segments.filter((s) => !/^\(.+\)$/.test(s)).join('/');
  if (collapsed === '') {
    return '/';
  }
  return `/${collapsed}`;
}

export function extractRouteFromChangedFilePath(path: string): string | undefined {
  const normalized = normalizePath(path);
  const match = ROUTE_SEGMENT_PATTERN.exec(normalized);
  if (match?.[1]) {
    return toRoutePath(match[1]);
  }

  const appMatch = APP_ROUTER_PATTERN.exec(normalized);
  if (appMatch?.[1]) {
    return toRoutePath(appMatch[1]);
  }

  return undefined;
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
