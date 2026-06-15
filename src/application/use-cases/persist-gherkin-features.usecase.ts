import { Inject, Injectable } from '@nestjs/common';

import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { QaScenario } from '../../domain/models/run.model.js';
import { GherkinFeatureRendererService } from '../services/gherkin-feature-renderer.service.js';

@Injectable()
export class PersistGherkinFeaturesUseCase {
  constructor(
    @Inject(GherkinFeatureRendererService) private readonly renderer: GherkinFeatureRendererService,
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
  ) {}

  async execute(input: {
    runDir: string;
    scenarios: QaScenario[];
    featureTitle?: string;
  }): Promise<{ featuresDir: string; files: string[] }> {
    const featuresDir = 'evidence/features';
    const features = this.renderer.renderAllFeatures({
      scenarios: input.scenarios,
      featureTitle: input.featureTitle,
    });

    const files: string[] = [];
    for (const [scenarioId, content] of Object.entries(features)) {
      const filename = `${featuresDir}/${scenarioId}.feature`;
      await this.repo.writeFile(input.runDir, filename, content);
      files.push(filename);
    }

    return { featuresDir, files };
  }
}
