import { describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';

import type { ClickUpReaderPort } from '../src/application/ports/clickup-reader.port.js';
import { ApplicationModule } from '../src/application/application.module.js';
import { ClickUpHttpReaderAdapter } from '../src/infra/clickup/clickup-http-reader.adapter.js';

describe('ClickUpReader Nest integration', () => {
  it('resolves ClickUpReaderPort as ClickUpHttpReaderAdapter', async () => {
    const app = await NestFactory.createApplicationContext(ApplicationModule, { logger: false });
    try {
      const reader = app.get<ClickUpReaderPort>('ClickUpReaderPort');
      expect(reader).toBeInstanceOf(ClickUpHttpReaderAdapter);
    } finally {
      await app.close();
    }
  });
});
