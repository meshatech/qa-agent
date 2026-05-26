import { Injectable } from '@nestjs/common';

import type { ClickUpApiPort, ClickUpReadAccessResult } from '../../application/ports/clickup-api.port.js';

const CLICKUP_USER_URL = 'https://api.clickup.com/api/v2/user';

@Injectable()
export class FetchClickUpApiAdapter implements ClickUpApiPort {
  async verifyReadAccess(token: string): Promise<ClickUpReadAccessResult> {
    try {
      const response = await fetch(CLICKUP_USER_URL, {
        headers: { Authorization: token },
      });

      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          statusCode: response.status,
          error: `ClickUp read access denied (${response.status})`,
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          error: `ClickUp API error (${response.status})`,
        };
      }

      return { ok: true, statusCode: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `ClickUp API request failed: ${message}` };
    }
  }
}
