import { Inject, Injectable, Optional } from '@nestjs/common';

import type {
  ClickUpReaderPort,
  ClickUpTaskReadResult,
} from '../../application/ports/clickup-reader.port.js';

@Injectable()
export class FakeClickUpReaderAdapter implements ClickUpReaderPort {
  private result: ClickUpTaskReadResult;

  constructor(@Optional() @Inject('CLICKUP_FAKE_RESULT') result?: ClickUpTaskReadResult) {
    this.result = result ?? FakeClickUpReaderAdapter.defaultResult();
  }

  setResult(result: ClickUpTaskReadResult): void {
    this.result = result;
  }

  async readTask(
    _taskId: string,
    _token: string,
    _options?: { configTeamId?: string },
  ): Promise<ClickUpTaskReadResult> {
    return this.result;
  }

  async readConfiguredTask(
    _token: string,
    _configTaskId?: string,
    _configTeamId?: string,
  ): Promise<ClickUpTaskReadResult> {
    return this.result;
  }

  static defaultResult(): ClickUpTaskReadResult {
    return {
      demand: {
        taskId: 'PRJ-11361',
        title: 'Criar DemandContext',
        description:
          'Criar o contrato de domínio DemandContext para representar a demanda extraída de uma task do ClickUp.',
        acceptanceCriteria: ['DemandContext é definido no domínio'],
        attachments: [
          {
            name: 'spec.pdf',
            url: 'https://example.com/spec.pdf',
            type: 'application/pdf',
          },
        ],
        status: 'fazendo',
        assignees: ['Joao de tal da silva'],
        priority: null,
        dueDate: null,
      },
    };
  }
}
