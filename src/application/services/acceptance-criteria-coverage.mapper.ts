import type { QaScenario } from '../../domain/models/run.model.js';
import { computeOverlapScore } from '../../domain/helpers/lexical-overlap.js';

export interface AcceptanceCriterionCoverage {
  criterion: string;
  scenarioId: string;
  scenarioTitle: string;
  score: number;
  source: 'coverageMetadata' | 'scenarioCriteria' | 'lexical';
  evidence?: string;
}

const MIN_COVERED_CRITERION_SCORE = 0.30;

function normalizeCriterionKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildAcceptanceCriteriaCoverageMap(input: {
  acceptanceCriteria: string[];
  scenarios: QaScenario[];
  minScore?: number;
}): AcceptanceCriterionCoverage[] {
  const { acceptanceCriteria, scenarios } = input;
  const minScore = input.minScore ?? MIN_COVERED_CRITERION_SCORE;

  if (!acceptanceCriteria.length || !scenarios.length) return [];

  const coverageMap: AcceptanceCriterionCoverage[] = [];

  for (const criterion of acceptanceCriteria) {
    if (!criterion.trim()) continue;

    let bestMatch: { scenario: QaScenario; score: number; evidence: string } | undefined;

    for (const scenario of scenarios) {
      const candidates: Array<{ text: string; evidence: string }> = [
        { text: scenario.title, evidence: 'scenario.title' },
      ];

      for (const task of scenario.tasks ?? []) {
        candidates.push({ text: task.title, evidence: 'task.title' });
        candidates.push({ text: task.expected, evidence: 'task.expected' });
      }

      for (const candidate of candidates) {
        const score = computeOverlapScore(criterion, candidate.text);
        if (score >= minScore) {
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { scenario, score, evidence: candidate.evidence };
          }
        }
      }
    }

    if (bestMatch) {
      coverageMap.push({
        criterion,
        scenarioId: bestMatch.scenario.id,
        scenarioTitle: bestMatch.scenario.title,
        score: bestMatch.score,
        source: 'lexical',
        evidence: `Matched ${bestMatch.evidence}`,
      });
    }
  }

  return coverageMap;
}

export function buildUncoveredCriteria(input: {
  acceptanceCriteria: string[];
  coverageMap: AcceptanceCriterionCoverage[];
}): string[] {
  const { acceptanceCriteria, coverageMap } = input;
  if (!acceptanceCriteria.length) return [];

  const covered = new Set(coverageMap.map((c) => normalizeCriterionKey(c.criterion)));
  return acceptanceCriteria.filter((c) => c.trim().length > 0 && !covered.has(normalizeCriterionKey(c)));
}
