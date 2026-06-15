-- Agent QA memory store — Fase 2 (BM25-first)
-- Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_memory_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  repo_url TEXT,
  memory_type TEXT NOT NULL,
  slug TEXT,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  route TEXT,
  component TEXT,
  scenario_id TEXT,
  old_locator TEXT,
  new_locator TEXT,
  failure_signature TEXT,
  evidence_url TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  promotion_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (promotion_status IN ('candidate', 'promoted', 'rejected', 'expired')),
  source_run_id TEXT NOT NULL,
  source_pr TEXT,
  source_commit_sha TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  -- Reserved for a future semantic-search phase (pgvector). Not populated yet.
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_chunks_project_status
  ON agent_memory_chunks (project_id, promotion_status);

CREATE INDEX IF NOT EXISTS idx_agent_memory_chunks_project_route
  ON agent_memory_chunks (project_id, route);

CREATE INDEX IF NOT EXISTS idx_agent_memory_chunks_failure_signature
  ON agent_memory_chunks (failure_signature);

CREATE TABLE IF NOT EXISTS qa_failure_fingerprints (
  project_id TEXT NOT NULL,
  failure_signature TEXT NOT NULL,
  route TEXT,
  component TEXT,
  broken_locator TEXT,
  first_seen_run_id TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  suggested_memory_id TEXT REFERENCES agent_memory_chunks (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, failure_signature)
);
