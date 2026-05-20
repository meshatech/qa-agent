import { Injectable } from '@nestjs/common';
import type { QaAction } from '../../domain/schemas/action.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { AttemptRecord, RuntimeErrorCode } from '../../domain/models/run.model.js';

@Injectable()
export class ActionPolicyService {
  validate(action: QaAction, config: RunConfig, attempts: AttemptRecord[]): { ok: true } | { ok: false; code: RuntimeErrorCode; message: string } {
    if (action.type === 'navigate' && config.allowedRoutes?.length) {
      const allowed = config.allowedRoutes.some((route) => action.to.startsWith(route.replace('*', '')));
      if (!allowed) return { ok: false, code: 'NAVIGATION_BLOCKED', message: `Route not allowed: ${action.to}` };
    }
    if (action.type === 'clickAtCoordinates') {
      const failures = attempts.filter((a) => ['click', 'fill', 'select', 'press', 'clickOutside'].includes(a.actionType) && a.result === 'FAILED').length;
      if (failures < 3) return { ok: false, code: 'RECOVERY_EXHAUSTED', message: 'clickAtCoordinates requires 3 previous semantic failures' };
    }
    return { ok: true };
  }
}
