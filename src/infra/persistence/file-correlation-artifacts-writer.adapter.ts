import { Injectable } from '@nestjs/common';

import type {
  CorrelationArtifactsWriterPort,
  CorrelationArtifactsWriteResult,
} from '../../application/ports/correlation-artifacts-writer.port.js';
import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';
import { CorrelationResultSchema } from '../../domain/schemas/correlation.schema.js';
import { writeAtomicFile } from './atomic-file-write.js';

const REQUIRED_SCENARIOS_FILE = 'required-scenarios.json';
const CORRELATION_REPORT_FILE = 'correlation-report.md';

@Injectable()
export class FileCorrelationArtifactsWriterAdapter implements CorrelationArtifactsWriterPort {
  async write(
    outputDir: string,
    result: CorrelationResult,
    reportMarkdown: string,
  ): Promise<CorrelationArtifactsWriteResult> {
    const validated = CorrelationResultSchema.parse(result);
    const [requiredScenariosPath, correlationReportPath] = await Promise.all([
      writeAtomicFile(outputDir, REQUIRED_SCENARIOS_FILE, JSON.stringify(validated, null, 2)),
      writeAtomicFile(outputDir, CORRELATION_REPORT_FILE, reportMarkdown),
    ]);

    return { requiredScenariosPath, correlationReportPath };
  }
}
