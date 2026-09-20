import { readFileSync } from 'node:fs';
import path from 'node:path';

import { recommendationGit } from './recommendation-endorsement-git.mjs';
import { RECOMMENDATION_REVIEW_EXTENSION } from './recommendation-review-record.mjs';

export const SPEC_ROOT = '.agents/spec-docs';
export const GOVERNED_STATES = ['todo', 'active', 'done'];
export const ALL_SPEC_STATES = ['draft', 'backlog', 'todo', 'active', 'done', 'rejected'];
export const LEDGER = '.agents/loop-runs/backlog-execution-orchestrator.jsonl';
export const BASELINE = 'scripts/harness/recommendation-endorsement-baseline.json';
export const POST_MERGE_LEDGER = '.agents/loop-runs/post-merge-cycle.jsonl';

export function recommendationFinding(pathname, detail) {
  return { path: pathname, detail };
}

export function exactRecommendationKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

export function bytesAt(root, revision, relative) {
  const listing = recommendationGit(root, [
    'ls-tree',
    '--full-tree',
    '-z',
    revision,
    '--',
    relative,
  ]);
  if (listing === '') return null;
  return recommendationGit(root, ['show', `${revision}:${relative}`]);
}

export function specsAt(root, revision, name) {
  const found = [];
  for (const state of ALL_SPEC_STATES) {
    const relative = `${SPEC_ROOT}/${state}/${name}`;
    const text = bytesAt(root, revision, relative);
    if (text !== null) found.push({ state, relative, text });
  }
  return found;
}

export function specAt(root, revision, name) {
  const found = specsAt(root, revision, name);
  return found.length === 1 ? found[0] : null;
}

export function indexText(root, relative) {
  const listing = recommendationGit(root, ['ls-files', '--stage', '--', relative]);
  if (listing === '') return null;
  return recommendationGit(root, ['show', `:${relative}`]);
}

export function indexSpecs(root, name) {
  const found = [];
  for (const state of ALL_SPEC_STATES) {
    const relative = `${SPEC_ROOT}/${state}/${name}`;
    const text = indexText(root, relative);
    if (text !== null) found.push({ state, relative, text });
  }
  return found;
}

export function indexSpec(root, name) {
  const found = indexSpecs(root, name);
  return found.length === 1 ? found[0] : null;
}

export function parseLedgerText(text) {
  if (text === null) return [];
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

export function ledgerAt(root, revision) {
  const text = bytesAt(root, revision, LEDGER);
  return parseLedgerText(text);
}

export function readRecommendationLedger(root) {
  const text = readFileSync(path.join(root, LEDGER), 'utf8');
  const entries = [];
  for (const [index, raw] of text.split('\n').entries()) {
    if (raw.trim() === '') continue;
    try {
      entries.push(JSON.parse(raw));
    } catch (error) {
      throw new Error(
        `recommendation-endorsement: ${LEDGER}:${index + 1} is malformed (${error.message}).`,
      );
    }
  }
  return entries;
}

function matchingExpectationCount(extension, observation) {
  if (!Array.isArray(extension.expectations)) return 0;
  return extension.expectations.filter(
    (candidate) =>
      candidate.round === observation.round &&
      candidate.subject === observation.subject &&
      candidate.revision === observation.revision &&
      candidate.projectionDigest === observation.projectionDigest &&
      candidate.endorsementKey === observation.endorsementKey &&
      candidate.agent === observation.agent,
  ).length;
}

export function recommendationObservations(entries, subject) {
  const result = [];
  for (const entry of entries) {
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    if (!extension || !Array.isArray(extension.observations)) continue;
    for (const observation of extension.observations) {
      if (observation?.subject !== subject) continue;
      result.push({
        observation,
        expectationCount: matchingExpectationCount(extension, observation),
        runId: entry.runId,
      });
    }
  }
  return result;
}

export function recommendationObservationSubjects(entries) {
  const subjects = new Set();
  for (const entry of entries) {
    const extension = entry?.extensions?.[RECOMMENDATION_REVIEW_EXTENSION];
    for (const observation of extension?.observations ?? []) {
      if (typeof observation?.subject === 'string') subjects.add(observation.subject);
    }
  }
  return subjects;
}

export function recommendationObservationKey(record) {
  return JSON.stringify(record);
}

export function subjectFromRecommendationSpecPath(pathname) {
  const match =
    /^\.agents\/spec-docs\/(?:draft|backlog|todo|active|done|rejected)\/([^/]+\.md)$/.exec(
      pathname,
    );
  return match?.[1] ?? null;
}

export function subjectWasPostApproval(root, name, revision) {
  const paths = GOVERNED_STATES.map((state) => `${SPEC_ROOT}/${state}/${name}`);
  return recommendationGit(root, ['rev-list', '-1', revision, '--', ...paths]).trim() !== '';
}

export function historicallyGovernedSubjects(root, revision, adoptionRevision) {
  const paths = GOVERNED_STATES.map((state) => `${SPEC_ROOT}/${state}`);
  const subjects = new Set();
  const adoptedPaths = recommendationGit(root, [
    'ls-tree',
    '-r',
    '--name-only',
    adoptionRevision,
    '--',
    ...paths,
    `${SPEC_ROOT}/rejected`,
  ]);
  for (const line of adoptedPaths.split('\n')) {
    const relative = line.trim();
    const subject = subjectFromRecommendationSpecPath(relative);
    const rejected = relative.startsWith(`${SPEC_ROOT}/rejected/`);
    if (subject && (!rejected || subjectWasPostApproval(root, subject, adoptionRevision))) {
      subjects.add(subject);
    }
  }
  const output = recommendationGit(root, [
    'log',
    '--format=',
    '--name-only',
    `${adoptionRevision}..${revision}`,
    '--',
    ...paths,
  ]);
  for (const line of output.split('\n')) {
    const subject = subjectFromRecommendationSpecPath(line.trim());
    if (subject) subjects.add(subject);
  }
  return subjects;
}

export function disappearedRecommendationSubjectFinding(subject, mode) {
  return recommendationFinding(
    `${SPEC_ROOT}/{todo,active,done,rejected}/${subject}`,
    `previously governed recommendation subject disappeared from ${mode}; deletion cannot erase the endorsement population`,
  );
}

export function changedRecommendationPaths(root, parent, commit) {
  const output = recommendationGit(root, ['diff', '--name-only', '--no-renames', parent, commit]);
  return output.split('\n').filter(Boolean);
}

export function recommendationTopicCommits(root, base) {
  const baseCommit = recommendationGit(root, ['rev-list', '-1', base]).trim();
  const headParents = recommendationGit(root, ['show', '--no-patch', '--format=%P', 'HEAD'])
    .split(/\s+/)
    .filter(Boolean);
  const replayHead =
    headParents.length === 2 && headParents[0] === baseCommit ? headParents[1] : 'HEAD';
  const output = recommendationGit(root, ['rev-list', '--reverse', `${base}..${replayHead}`]);
  return output.split('\n').filter(Boolean);
}

export function stagedRecommendationPaths(root) {
  const output = recommendationGit(root, ['diff', '--cached', '--name-only', '--no-renames']);
  return output.split('\n').filter(Boolean);
}

export function isRecommendationPlanningPath(pathname, subject) {
  return (
    pathname === `.agents/tasks/${subject}` ||
    pathname === LEDGER ||
    pathname === POST_MERGE_LEDGER ||
    (pathname.startsWith(`${SPEC_ROOT}/`) && pathname.endsWith(`/${subject}`))
  );
}

export function addedRecommendationObservations(beforeEntries, afterEntries, subject) {
  const before = new Set(
    recommendationObservations(beforeEntries, subject).map(recommendationObservationKey),
  );
  return recommendationObservations(afterEntries, subject).filter(
    (record) => !before.has(recommendationObservationKey(record)),
  );
}

export function collectRecommendationTopicSubjects(root, commits) {
  const subjects = new Set();
  const ledgerSubjects = new Set();
  for (const commit of commits) {
    const parent = recommendationGit(root, ['rev-parse', `${commit}^`]).trim();
    const paths = changedRecommendationPaths(root, parent, commit);
    for (const pathname of paths) {
      const subject = subjectFromRecommendationSpecPath(pathname);
      if (subject) subjects.add(subject);
    }
    if (!paths.includes(LEDGER)) continue;
    for (const revision of [parent, commit]) {
      for (const subject of recommendationObservationSubjects(ledgerAt(root, revision))) {
        subjects.add(subject);
        ledgerSubjects.add(subject);
      }
    }
  }
  return { subjects, ledgerSubjects };
}

export function collectRecommendationStagedSubjects(
  root,
  base,
  paths,
  governed,
  beforeLedger,
  afterLedger,
) {
  const subjects = new Set();
  for (const commit of recommendationTopicCommits(root, base)) {
    const parent = recommendationGit(root, ['rev-parse', `${commit}^`]).trim();
    for (const pathname of changedRecommendationPaths(root, parent, commit)) {
      const subject = subjectFromRecommendationSpecPath(pathname);
      if (subject) subjects.add(subject);
    }
  }
  for (const pathname of paths) {
    const subject = subjectFromRecommendationSpecPath(pathname);
    if (subject) subjects.add(subject);
  }
  if (paths.includes(LEDGER)) {
    for (const subject of recommendationObservationSubjects(beforeLedger)) subjects.add(subject);
    for (const subject of recommendationObservationSubjects(afterLedger)) subjects.add(subject);
  }
  for (const subject of governed) {
    if (indexSpecs(root, subject).length === 0) subjects.add(subject);
  }
  return subjects;
}
