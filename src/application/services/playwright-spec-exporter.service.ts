import { Injectable } from '@nestjs/common';
import type { QaRunResult } from '../../domain/models/run.model.js';

@Injectable()
export class PlaywrightSpecExporter {
  export(result: QaRunResult): string {
    const lines = [
      "import { test, expect } from '@playwright/test';",
      '',
      "test('agent-qa generated flow (experimental)', async ({ page }) => {",
      "  // Experimental export generated after execution. It is not used by Agent QA runtime.",
    ];
    for (const step of result.steps) {
      const action = step.resolvedAction;
      if (action.type === 'navigate') lines.push(`  await page.goto(${JSON.stringify(action.to)});`);
      if (action.type === 'click' && step.boundExpected && 'target' in step.boundExpected && step.boundExpected.target?.locator) lines.push(`  await ${this.locator('page', step.boundExpected.target.locator)}.click();`);
      if (action.type === 'fill' && step.boundExpected && 'target' in step.boundExpected && step.boundExpected.target?.locator) lines.push(`  await ${this.locator('page', step.boundExpected.target.locator)}.fill(${JSON.stringify(action.value)});`);
      if (step.boundExpected?.type === 'url_contains') lines.push(`  await expect(page).toHaveURL(/${this.escapeRegex(step.boundExpected.value)}/);`);
      if (step.boundExpected?.type === 'text_visible') lines.push(`  await expect(page.getByText(${JSON.stringify(step.boundExpected.text)})).toBeVisible();`);
    }
    lines.push('});', '');
    return lines.join('\n');
  }

  private locator(page: string, locator: { strategy: string; role?: string; name?: string; text?: string; value?: string; texts?: string[] }): string {
    if (locator.strategy === 'role') return `${page}.getByRole(${JSON.stringify(locator.role)}, { name: ${JSON.stringify(locator.name)} })`;
    if (locator.strategy === 'label') return `${page}.getByLabel(${JSON.stringify(locator.text)})`;
    if (locator.strategy === 'placeholder') return `${page}.getByPlaceholder(${JSON.stringify(locator.text)})`;
    if (locator.strategy === 'testid') return `${page}.getByTestId(${JSON.stringify(locator.value)})`;
    if (locator.strategy === 'text_any') return `${page}.getByText(/${(locator.texts ?? []).map((text) => this.escapeRegex(text)).join('|')}/i).first()`;
    return `${page}.getByText(${JSON.stringify(locator.text ?? locator.name ?? '')})`;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
