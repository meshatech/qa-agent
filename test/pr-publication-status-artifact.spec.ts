import { describe, expect, it } from 'vitest';
import { buildPublicationStatusArtifact } from '../src/application/services/pr-publication-status-artifact.js';

describe('buildPublicationStatusArtifact', () => {
  it('builds artifact for successful publication', () => {
    const artifact = buildPublicationStatusArtifact({
      attempted: true,
      published: true,
      fallback: false,
      repository: 'owner/repo',
      pullNumber: 42,
      commitSha: 'abc123',
      headRef: 'feature-branch',
      baseRef: 'main',
    });

    expect(artifact.version).toBe(1);
    expect(artifact.attempted).toBe(true);
    expect(artifact.published).toBe(true);
    expect(artifact.fallback).toBe(false);
    expect(artifact.reason).toBeUndefined();
    expect(artifact.repository).toBe('owner/repo');
    expect(artifact.pullNumber).toBe(42);
    expect(artifact.commitSha).toBe('abc123');
    expect(artifact.headRef).toBe('feature-branch');
    expect(artifact.baseRef).toBe('main');
    expect(artifact.statusCode).toBeUndefined();
    expect(artifact.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('builds artifact when token is absent', () => {
    const artifact = buildPublicationStatusArtifact({
      attempted: false,
      published: false,
      fallback: true,
      reason: 'Not published: token not provided',
      repository: 'owner/repo',
      pullNumber: 123,
    });

    expect(artifact.attempted).toBe(false);
    expect(artifact.published).toBe(false);
    expect(artifact.fallback).toBe(true);
    expect(artifact.reason).toBe('Not published: token not provided');
    expect(artifact.statusCode).toBeUndefined();
  });

  it('builds artifact for failed publication with status code', () => {
    const artifact = buildPublicationStatusArtifact({
      attempted: true,
      published: false,
      fallback: true,
      reason: 'Not published: token lacks permission',
      repository: 'owner/repo',
      pullNumber: 99,
      statusCode: 403,
    });

    expect(artifact.attempted).toBe(true);
    expect(artifact.published).toBe(false);
    expect(artifact.fallback).toBe(true);
    expect(artifact.reason).toBe('Not published: token lacks permission');
    expect(artifact.statusCode).toBe(403);
  });

  it('builds artifact for network failure without status code', () => {
    const artifact = buildPublicationStatusArtifact({
      attempted: true,
      published: false,
      fallback: true,
      reason: 'Not published: GitHub API request failed',
      repository: 'owner/repo',
      pullNumber: 7,
    });

    expect(artifact.attempted).toBe(true);
    expect(artifact.statusCode).toBeUndefined();
  });

  it('does not include token in reason even if passed', () => {
    const artifact = buildPublicationStatusArtifact({
      attempted: true,
      published: false,
      fallback: true,
      reason: 'Bearer [REDACTED] failed',
      repository: 'owner/repo',
      pullNumber: 1,
    });

    expect(artifact.reason).toBe('Bearer [REDACTED] failed');
    expect(JSON.stringify(artifact)).not.toContain('ghp_secret');
  });
});
