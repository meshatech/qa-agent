export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: string, message: string): Result<T> => ({
  ok: false,
  error: new DomainError(code, message),
});
