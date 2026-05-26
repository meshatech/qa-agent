export interface GitRepositoryPort {
  isShallowRepository(cwd: string): Promise<boolean>;
  hasRemoteBranch(baseRef: string, cwd: string): Promise<boolean>;
  diffPullRequest(baseBranch: string, cwd: string): Promise<string>;
}
