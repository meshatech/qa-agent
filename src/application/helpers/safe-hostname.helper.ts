/**
 * Safely extracts hostname from a URL string.
 */
export function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
