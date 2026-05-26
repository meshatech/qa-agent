import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PreflightReportWriterPort } from '../../application/ports/preflight-report-writer.port.js';
import type { PreflightReport } from '../../domain/schemas/preflight-report.schema.js';

@Injectable()
export class FilePreflightReportWriterAdapter implements PreflightReportWriterPort {
  async write(outputDir: string, report: PreflightReport): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const path = resolve(join(outputDir, 'preflight-report.json'));
    await writeFile(path, JSON.stringify(report, null, 2), 'utf8');
    return path;
  }
}
