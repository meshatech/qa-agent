import { Injectable } from '@nestjs/common';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  CorrelationArtifactsWriterPort,
  CorrelationArtifactsWriteResult,
} from '../../application/ports/correlation-artifacts-writer.port.js';
import { prepareCorrelationReportArtifact } from '../../domain/helpers/correlation-report-artifact.js';
import { prepareRequiredScenariosArtifact } from '../../domain/helpers/required-scenarios-artifact.js';
import type { CorrelationReportContext } from '../../domain/helpers/correlation-report.renderer.js';
import type { CorrelationResult } from '../../domain/schemas/correlation.schema.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import { prepareSelectedScenariosArtifact } from '../../domain/helpers/selected-scenarios-artifact.js';
import { commitAtomicJsonWrite } from './atomic-json-write.js';
import { writeAtomicFile } from './atomic-file-write.js';

const REQUIRED_SCENARIOS_FILE = 'required-scenarios.json';
const CORRELATION_REPORT_FILE = 'correlation-report.md';
const SELECTED_SCENARIOS_FILE = 'selected-scenarios.json';
const STAGING_DIR_PREFIX = '.correlation-artifacts-';

@Injectable()
export class FileCorrelationArtifactsWriterAdapter implements CorrelationArtifactsWriterPort {
  async write(
    outputDir: string,
    result: CorrelationResult,
    selectedScenarios?: QaScenario[],
    context?: CorrelationReportContext,
  ): Promise<CorrelationArtifactsWriteResult> {
    await mkdir(outputDir, { recursive: true });
    const stagingDir = await mkdtemp(join(outputDir, STAGING_DIR_PREFIX));

    try {
      const requiredScenariosContent = prepareRequiredScenariosArtifact(result);
      const correlationReportContent = prepareCorrelationReportArtifact(result, context);

      await writeAtomicFile(stagingDir, REQUIRED_SCENARIOS_FILE, requiredScenariosContent);
      await writeAtomicFile(stagingDir, CORRELATION_REPORT_FILE, correlationReportContent);

      const requiredScenariosPath = resolve(join(outputDir, REQUIRED_SCENARIOS_FILE));
      const correlationReportPath = resolve(join(outputDir, CORRELATION_REPORT_FILE));

      await commitAtomicJsonWrite(
        resolve(join(stagingDir, REQUIRED_SCENARIOS_FILE)),
        requiredScenariosPath,
      );
      await commitAtomicJsonWrite(
        resolve(join(stagingDir, CORRELATION_REPORT_FILE)),
        correlationReportPath,
      );

      let selectedScenariosPath: string | undefined;
      if (selectedScenarios && selectedScenarios.length > 0) {
        const selectedContent = prepareSelectedScenariosArtifact(selectedScenarios);
        await writeAtomicFile(stagingDir, SELECTED_SCENARIOS_FILE, selectedContent);
        selectedScenariosPath = resolve(join(outputDir, SELECTED_SCENARIOS_FILE));
        await commitAtomicJsonWrite(
          resolve(join(stagingDir, SELECTED_SCENARIOS_FILE)),
          selectedScenariosPath,
        );
      }

      return { requiredScenariosPath, correlationReportPath, selectedScenariosPath };
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
