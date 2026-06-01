export interface PipelineGenerateMemoryRunResult {
  memoryPath: string;
  chunksGenerated: number;
  routeChunks: number;
  componentChunks: number;
  locatorChunks: number;
  projectChunk: boolean;
}
