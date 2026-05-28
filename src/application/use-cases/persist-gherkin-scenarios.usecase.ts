import { Inject, Injectable } from '@nestjs/common';

import type { RunRepositoryPort } from '../ports/run-repository.port.js';
import type { SelectedScenariosArtifact } from '../../domain/schemas/selected-scenarios-artifact.schema.js';
import { GherkinRendererService } from '../services/gherkin-renderer.service.js';

@Injectable()
export class PersistGherkinScenariosUseCase {
  constructor(
    @Inject(GherkinRendererService) private readonly renderer: GherkinRendererService,
    @Inject('RunRepositoryPort') private readonly repo: RunRepositoryPort,
  ) {}

  async execute(input: {
    runDir: string;
    artifact: SelectedScenariosArtifact;
  }): Promise<string> {
    const markdown = this.renderer.renderMarkdown(input.artifact);
    await this.repo.writeFile(input.runDir, 'selected-scenarios.md', markdown);
    return markdown;
  }
}
