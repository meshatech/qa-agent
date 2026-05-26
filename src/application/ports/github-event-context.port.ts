export interface GitHubEventContextPort {
  resolvePullNumber(): Promise<number | undefined>;
}
