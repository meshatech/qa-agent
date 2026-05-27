export const SECRET_REDACTION_MASK = '***REDACTED***';

/** Display-safe token for logs (never log full value). */
export function sanitizeToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 8) {
    return '****';
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function collectSecretVariants(secret: string): string[] {
  const trimmed = secret.trim();
  if (!trimmed) {
    return [];
  }

  const variants = new Set<string>([trimmed]);
  variants.add(encodeURIComponent(trimmed));
  if (trimmed.length >= 4) {
    variants.add(Buffer.from(trimmed, 'utf8').toString('base64'));
  }

  return [...variants]
    .filter((variant) => variant.length >= 4)
    .sort((left, right) => right.length - left.length);
}

/** Replace known secret literals in user-facing messages. */
export function redactSecretsInMessage(message: string, secrets: string[]): string {
  let result = message;
  const variants = secrets.flatMap((secret) => collectSecretVariants(secret));
  const uniqueVariants = [...new Set(variants)].sort((left, right) => right.length - left.length);

  for (const variant of uniqueVariants) {
    result = result.split(variant).join(SECRET_REDACTION_MASK);
  }

  return result;
}
