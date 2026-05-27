export const SECRET_REDACTION_MASK = '***REDACTED***';

/** Display-safe token for logs (never log full value). */
export function sanitizeToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return '****';
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

/** Replace known secret literals in user-facing messages. */
export function redactSecretsInMessage(message: string, secrets: string[]): string {
  let result = message;
  for (const secret of secrets.map((value) => value.trim()).filter(Boolean)) {
    result = result.split(secret).join(SECRET_REDACTION_MASK);
  }
  return result;
}
