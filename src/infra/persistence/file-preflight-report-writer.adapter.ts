import { Injectable } from '@nestjs/common';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PreflightReportWriterPort } from '../../application/ports/preflight-report-writer.port.js';
import type { PreflightReport } from '../../domain/schemas/preflight-report.schema.js';

@Injectable()
export class FilePreflightReportWriterAdapter implements PreflightReportWriterPort {
  async write(outputDir: string, report: PreflightReport): Promise<string> {
    await mkdir(outputDir, { recursive: true });
    const path = resolve(join(outputDir, 'preflight-report.json'));
    const tmpPath = `${path}.tmp`;
    const payload = JSON.stringify(report, null, 2);
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, path);
    return path;
  }
}
