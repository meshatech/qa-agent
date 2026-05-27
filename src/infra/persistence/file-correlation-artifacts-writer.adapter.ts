import { Injectable } from '@nestjs/common';

import type {
  CorrelationArtifactsWriterPort,
  CorrelationArtifactsWriteResult,
} from '../../application/ports/correlation-artifacts-writer.port.js';
import { prepareCorrelationReportArtifact } from '../../domain/helpers/correlation-report-artifact.js';
import { prepareRequiredScenariosArtifact } from '../../domain/helpers/required-scenarios-artifact.js';
import type { CorrelationReportContext } from '../../domain/helpers/correlation-report.renderer.js';
import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';
import { writeAtomicFile } from './atomic-file-write.js';

const REQUIRED_SCENARIOS_FILE = 'required-scenarios.json';
const CORRELATION_REPORT_FILE = 'correlation-report.md';

@Injectable()
export class FileCorrelationArtifactsWriterAdapter implements CorrelationArtifactsWriterPort {
  async write(
    outputDir: string,
    result: CorrelationResult,
    context?: CorrelationReportContext,
  ): Promise<CorrelationArtifactsWriteResult> {
    const [requiredScenariosPath, correlationReportPath] = await Promise.all([
      writeAtomicFile(outputDir, REQUIRED_SCENARIOS_FILE, prepareRequiredScenariosArtifact(result)),
      writeAtomicFile(
        outputDir,
        CORRELATION_REPORT_FILE,
        prepareCorrelationReportArtifact(result, context),
      ),
    ]);

    return { requiredScenariosPath, correlationReportPath };
  }
}
