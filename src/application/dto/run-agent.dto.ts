import { z } from 'zod';

export const RunAgentDtoSchema = z.object({
  configPath: z.string().default('./agent-qa.config.json'),
  headed: z.boolean().optional(),
  dryRun: z.boolean().default(false),
  outputDir: z.string().optional(),
  demandPath: z.string().optional(),
  scenarioId: z.string().optional(),
  maxScenarios: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  verbose: z.boolean().default(false),
});

export type RunAgentDto = z.infer<typeof RunAgentDtoSchema>;
