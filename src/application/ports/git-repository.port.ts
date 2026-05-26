export interface GitRepositoryPort {
  isShallowRepository(cwd: string): Promise<boolean>;
  hasRemoteBranch(baseRef: string, cwd: string): Promise<boolean>;
}
