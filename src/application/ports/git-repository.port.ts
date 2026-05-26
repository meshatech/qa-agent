export interface GitRepositoryPort {
  isShallowRepository(cwd: string): Promise<boolean>;
  hasRemoteBranch(baseRef: string, cwd: string): Promise<boolean>;
  ensureBaseBranchAvailable(baseBranch: string, cwd: string): Promise<void>;
  diffPullRequest(baseBranch: string, cwd: string): Promise<string>;
}
