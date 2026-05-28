import type { MemoryChunk } from '../../domain/schemas/memory.schema.js';
import type { ScenarioCatalogItem, ScenarioCatalogItemPriority } from '../../domain/models/scenario-catalog-item.model.js';
import { truncate } from '../../domain/helpers/text-utils.js';

export function mapScenarioChunkToCatalogItem(chunk: MemoryChunk): ScenarioCatalogItem {
  const metadata = chunk.metadata ?? {};

  const id = extractString(metadata.id) ?? extractString(metadata.scenarioId) ?? chunk.id;
  const title = extractString(metadata.title) ?? extractString(metadata.name) ?? chunk.title ?? `Scenario ${chunk.id}`;

  const route = extractString(metadata.route);
  const component = extractString(metadata.component);
  const criteria = extractStringArray(metadata.criteria) ?? extractStringArray(metadata.acceptanceCriteria);
  const tags = extractStringArray(metadata.tags);
  const priority = extractPriority(metadata.priority);

  const description = truncate(chunk.content ?? '', 200);

  return {
    id,
    title,
    description,
    route,
    component,
    criteria,
    tags,
    priority,
    source: 'memory',
    memoryChunkId: chunk.id,
  };
}

function extractString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function extractStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const filtered = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (filtered.length > 0) return filtered;
  }
  return undefined;
}

function extractPriority(value: unknown): ScenarioCatalogItemPriority | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  const valid: ScenarioCatalogItemPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  if (valid.includes(normalized as ScenarioCatalogItemPriority)) {
    return normalized as ScenarioCatalogItemPriority;
  }
  return undefined;
}

