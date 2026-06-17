import type { Pool } from 'pg';

// Mirrors migrations/0002_project_knowledge.sql. Kept inline so it ships with the
// compiled bundle regardless of where dist/ is run from (see that file for the
// canonical, human-readable copy used for manual psql runs).
const MIGRATION_0002_PROJECT_KNOWLEDGE = `
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
`;

const MIGRATIONS: ReadonlyArray<{ id: string; sql: string }> = [
  { id: '0002_project_knowledge', sql: MIGRATION_0002_PROJECT_KNOWLEDGE },
];

export async function runProjectMemoryMigrations(pool: Pool): Promise<void> {
  for (const migration of MIGRATIONS) {
    await pool.query(migration.sql);
  }
}
