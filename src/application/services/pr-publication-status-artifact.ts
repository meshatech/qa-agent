export interface PRPublicationStatusArtifact {
  version: 1;
  generatedAt: string;
  attempted: boolean;
  published: boolean;
  fallback: boolean;
  reason?: string;
  repository: string;
  pullNumber: number;
  commitSha?: string;
  headRef?: string;
  baseRef?: string;
  statusCode?: number;
}

export function buildPublicationStatusArtifact(input: {
  attempted: boolean;
  published: boolean;
  fallback: boolean;
  reason?: string;
  repository: string;
  pullNumber: number;
  commitSha?: string;
  headRef?: string;
  baseRef?: string;
  statusCode?: number;
}): PRPublicationStatusArtifact {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    attempted: input.attempted,
    published: input.published,
    fallback: input.fallback,
    reason: input.reason,
    repository: input.repository,
    pullNumber: input.pullNumber,
    commitSha: input.commitSha,
    headRef: input.headRef,
    baseRef: input.baseRef,
    statusCode: input.statusCode,
  };
}
