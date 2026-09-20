import { spawnSync } from 'node:child_process';

import { resolveBaseRef } from './shared.mjs';

export function recommendationGitResult(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new Error(
      `recommendation-endorsement: git ${args.join(' ')} failed (${result.error.message}).`,
    );
  }
  return result;
}

export function recommendationGit(root, args) {
  const result = recommendationGitResult(root, args);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`recommendation-endorsement: git ${args.join(' ')} failed (${detail}).`);
  }
  return result.stdout;
}

export function recommendationCommitExists(root, revision) {
  return (
    recommendationGitResult(root, ['rev-parse', '--verify', `${revision}^{commit}`]).status === 0
  );
}

export function resolveRecommendationBaseRef(root, explicitBaseRef, env = process.env) {
  return resolveBaseRef({
    explicitBaseRef,
    env,
    refExists: (candidate) => recommendationCommitExists(root, candidate),
  });
}

export function recommendationIsAncestor(root, ancestor, descendant) {
  const args = ['merge-base', '--is-ancestor', ancestor, descendant];
  const result = recommendationGitResult(root, args);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const detail = result.stderr.trim() || `exit ${result.status}`;
  throw new Error(
    `recommendation-endorsement: git merge-base --is-ancestor ${ancestor} ${descendant} failed (${detail}).`,
  );
}
