-- Long-term project knowledge for V3 auto-config (doc section 6).
-- Keyed by repo + base branch. The full structured knowledge is stored as JSONB
-- (validated against ProjectKnowledgeSchema in the app layer); top-level columns
-- are denormalized for cheap metadata queries.

CREATE TABLE IF NOT EXISTS agent_project_knowledge (
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'project-knowledge.v1',
  knowledge_json JSONB NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL,
  commit_sha TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repo, branch)
);

CREATE INDEX IF NOT EXISTS idx_agent_project_knowledge_repo
  ON agent_project_knowledge (repo);
