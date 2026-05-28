import type { QaScenario } from './run.model.js';

export type ScenarioCatalogItemSource = 'memory' | 'catalog' | 'generated' | 'manual';
export type ScenarioCatalogItemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ScenarioCatalogItem {
  id: string;
  title: string;
  description?: string;
  route?: string;
  component?: string;
  criteria?: string[];
  tags?: string[];
  priority?: ScenarioCatalogItemPriority;
  source: ScenarioCatalogItemSource;
  memoryChunkId?: string;
  scenario?: QaScenario;
  createdAt?: string;
  updatedAt?: string;
}
