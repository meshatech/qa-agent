import { Injectable } from '@nestjs/common';

const MASK = '***REDACTED***';
const secretKey = /\b(password|secret|token|api[_-]?key|authorization|cookie)\b/i;
const patterns = [
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /pk_[a-zA-Z0-9_-]{8,}/gi,
  /gh[pousr]_[a-zA-Z0-9_]{8,}/gi,
];

@Injectable()
export class SanitizerService {
  private readonly counts: Record<string, number> = {};

  stats(): Record<string, number> {
    return { ...this.counts };
  }

  sanitize<T>(input: T): T {
    if (typeof input === 'string') return patterns.reduce<string>((s, p) => s.replace(p, () => this.mark('strings')), input) as T;
    if (Array.isArray(input)) return input.map((v) => this.sanitize(v)) as T;
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, secretKey.test(k) ? this.mark('keys') : this.sanitize(v)])) as T;
    }
    return input;
  }

  sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    return this.sanitize(headers);
  }

  sanitizeCookies(cookies: unknown): unknown {
    return this.sanitize(cookies);
  }

  sanitizeForOutput<T>(input: T, knownSecrets: string[] = []): T {
    const secrets = knownSecrets.map((value) => value.trim()).filter((value) => value.length > 0);
    return this.sanitizeStringsDeep(input, secrets);
  }

  containsLeakedSecrets(serialized: string, knownSecrets: string[] = []): boolean {
    const secrets = knownSecrets.map((value) => value.trim()).filter((value) => value.length > 0);
    if (secrets.some((secret) => serialized.includes(secret))) return true;
    return patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(serialized);
    });
  }

  private sanitizeStringsDeep<T>(input: T, secrets: string[]): T {
    if (typeof input === 'string') {
      let value = patterns.reduce<string>((current, pattern) => current.replace(pattern, () => this.mark('strings')), input);
      for (const secret of secrets) {
        value = value.split(secret).join(MASK);
      }
      return value as T;
    }
    if (Array.isArray(input)) return input.map((item) => this.sanitizeStringsDeep(item, secrets)) as T;
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [key, this.sanitizeStringsDeep(value, secrets)]),
      ) as T;
    }
    return input;
  }

  private mark(kind: string): string {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return MASK;
  }
}
