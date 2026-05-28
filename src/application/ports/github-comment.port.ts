export interface GitHubCommentPort {
  postComment(input: {
    repository: string;
    pullNumber: number;
    body: string;
    token: string;
  }): Promise<void>;
}
