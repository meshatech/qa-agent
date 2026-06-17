export interface ProjectAnalysisInputDto {
  repo: string;
  branch: string;
  commitSha?: string;
  previewUrl?: string;
  projectPath: string;
  changedFiles: string[];
  affectedRoutes: string[];
  demand?: { title: string; description: string; acceptanceCriteria?: string[] };
  llmModel?: string;
}
