export interface GitHubPrCommentPermissionResult {
  ok: boolean;
  statusCode?: number;
  warning?: string;
  repository?: string;
  pullNumber?: number;
}

export interface GitHubApiPort {
  verifyPrCommentPermission(params: {
    token: string;
    repository: string;
    pullNumber: number;
  }): Promise<GitHubPrCommentPermissionResult>;
}
