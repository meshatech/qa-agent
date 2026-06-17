import { readFileSync } from 'node:fs';

/**
 * Resolves the Postgres connection string, translating `host.docker.internal` to the
 * container→host gateway IP on Linux (where Docker does not resolve that name by default).
 * Shared by the memory store and project-memory Postgres adapters.
 */
export function resolveDatabaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (!raw.includes('host.docker.internal')) return raw;
  try {
    const route = readFileSync('/proc/net/route', 'utf8');
    const line = route.split('\n').find((l: string) => l.startsWith('eth0') || l.startsWith('ens'));
    if (line) {
      const gatewayHex = line.trim().split(/\s+/)[2];
      if (gatewayHex) {
        const octets = [
          parseInt(gatewayHex.slice(6, 8), 16),
          parseInt(gatewayHex.slice(4, 6), 16),
          parseInt(gatewayHex.slice(2, 4), 16),
          parseInt(gatewayHex.slice(0, 2), 16),
        ];
        const gatewayIp = octets.join('.');
        return raw.replace(/host\.docker\.internal/g, gatewayIp);
      }
    }
  } catch {
    // Fallback: leave host.docker.internal as-is and let DNS resolve it
  }
  return raw;
}
