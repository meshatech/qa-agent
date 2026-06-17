import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  ProjectMemoryKey,
  ProjectMemoryStorePort,
} from '../../application/ports/project-memory-store.port.js';
import {
  ProjectKnowledgeSchema,
  type ProjectKnowledge,
} from '../../domain/schemas/project-knowledge.schema.js';
import { commitAtomicJsonWrite } from '../persistence/atomic-json-write.js';

const PROJECT_KNOWLEDGE_DIR = join('.agent-qa', 'project-knowledge');

/**
 * File-based fallback for the project memory store (local dev without DATABASE_URL).
 * Stores one JSON file per repo+branch under `.agent-qa/project-knowledge/`.
 */
@Injectable()
export class FileProjectMemoryAdapter implements ProjectMemoryStorePort {
  constructor(private readonly baseDir: string = process.cwd()) {}

  async load(key: ProjectMemoryKey): Promise<ProjectKnowledge | null> {
    const path = this.pathFor(key);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return null;
    }
    return ProjectKnowledgeSchema.parse(JSON.parse(raw));
  }

  async save(knowledge: ProjectKnowledge): Promise<void> {
    const path = this.pathFor({ repo: knowledge.metadata.repo, branch: knowledge.metadata.branch });
    await mkdir(resolve(this.baseDir, PROJECT_KNOWLEDGE_DIR), { recursive: true });
    const tmpPath = `${path}.tmp.${Date.now()}`;
    await writeFile(tmpPath, JSON.stringify(knowledge, null, 2), 'utf8');
    await commitAtomicJsonWrite(tmpPath, path);
  }

  private pathFor(key: ProjectMemoryKey): string {
    return resolve(this.baseDir, PROJECT_KNOWLEDGE_DIR, `${slug(key.repo)}__${slug(key.branch)}.json`);
  }
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}
