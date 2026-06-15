export interface PipelineLearningRunResult {
  candidatesPath: string;
  count: number;
  confirmedCount: number;
  inferredCount: number;
  gapCount: number;
  semanticLocatorSuggestions: number;
  hasEphemeralIdsFiltered: boolean;
  knownFailuresCount: number;
}
