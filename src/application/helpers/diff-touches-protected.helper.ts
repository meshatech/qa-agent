import type { PrDiffContext } from '../../domain/schemas/pr-diff-context.schema.js';
import type { ProjectKnowledge } from '../../domain/schemas/project-knowledge.schema.js';

/**
 * Checks whether the PR diff touches routes or modules that are known to require auth.
 */
export function diffTouchesProtected(prDiff: PrDiffContext, knowledge: ProjectKnowledge): boolean {
  const protectedRoutes = knowledge.modulesRequiringAuth
    .map((m) => m.route)
    .filter((r): r is string => typeof r === 'string' && r.length > 0);
  if (protectedRoutes.some((r) => prDiff.affectedRoutes.includes(r))) return true;

  const paths = prDiff.changedFiles.map((f) => f.path);
  const loginModule = knowledge.auth.loginModule;
  if (loginModule && paths.some((p) => p.includes(loginModule))) return true;

  return false;
}
