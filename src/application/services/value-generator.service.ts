import { Injectable } from '@nestjs/common';
import type { ExpectedOutcome } from '../../domain/schemas/expected-outcome.schema.js';

@Injectable()
export class ValueGeneratorService {
  generate(taskTitle: string, outcome: ExpectedOutcome): string {
    const explicitLiteral = this.explicitLiteral(`${taskTitle} ${outcome.description}`);
    if (explicitLiteral) return explicitLiteral;
    const lower = taskTitle.toLowerCase();
    if (lower.includes('email') || lower.includes('e-mail') || lower.includes('correio') || lower.includes('mail')) {
      return 'test@example.com';
    }
    if (lower.includes('password') || lower.includes('senha') || lower.includes('pass') || lower.includes('passwd')) {
      return 'Test@123456';
    }
    return 'safe-test-value';
  }

  private explicitLiteral(value: string): string | undefined {
    const match = value.match(/['"`]([^'"`]+)['"`]/);
    return match?.[1]?.trim() || undefined;
  }
}
