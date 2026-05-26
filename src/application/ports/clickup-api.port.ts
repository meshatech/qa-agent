export interface ClickUpReadAccessResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

export interface ClickUpApiPort {
  verifyReadAccess(token: string): Promise<ClickUpReadAccessResult>;
}
