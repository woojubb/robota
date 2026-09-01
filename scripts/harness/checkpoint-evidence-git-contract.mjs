import { spawnSync } from 'node:child_process';

import {
  parseCheckpointEvidenceContract,
  rawGateImplementPassEntries,
} from './checkpoint-evidence-contract.mjs';
import { envWithoutGitVars } from './shared.mjs';

const RULE_PATH = '.agents/rules/backlog-execution.md';
const SPEC_PREFIX = '.agents/spec-docs/';

function runGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: envWithoutGitVars(),
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '').trim(),
  };
}

function lines(text) {
  return String(text).split('\n').filter(Boolean);
}

function gitText(root, revision, file) {
  const result = runGit(root, ['show', `${revision}:${file}`]);
  return result.code === 0 ? result.stdout : null;
}

function validAt(root, revision) {
  const rule = gitText(root, revision, RULE_PATH);
  return rule !== null && parseCheckpointEvidenceContract(rule).ok;
}

export function checkpointEvidenceContractState(root, revision = 'HEAD') {
  const listed = runGit(root, ['rev-list', '--reverse', revision, '--', RULE_PATH]);
  if (listed.code !== 0) {
    throw new Error(
      `cannot inspect checkpoint contract ancestry: ${listed.stderr || '(no stderr)'}`,
    );
  }
  const commits = lines(listed.stdout);
  const markerCommits = commits.filter((commit) =>
    String(gitText(root, commit, RULE_PATH) ?? '').includes('checkpoint-evidence-contract:v1:'),
  );
  const cutovers = commits.filter((commit) => {
    if (!validAt(root, commit)) return false;
    const parents = runGit(root, ['rev-list', '--parents', '-n', '1', commit]);
    if (parents.code !== 0) {
      throw new Error(
        `cannot inspect checkpoint contract parents: ${parents.stderr || '(no stderr)'}`,
      );
    }
    return parents.stdout
      .trim()
      .split(/\s+/)
      .slice(1)
      .every((parent) => !validAt(root, parent));
  });
  return { cutovers, markerCommits, valid: validAt(root, revision) };
}

function entryCounts(specText) {
  const counts = new Map();
  for (const entry of rawGateImplementPassEntries(specText)) {
    const key = entry.trimEnd();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function legacyCheckpointEntries(root, cutover, revision, basename) {
  const parent = runGit(root, ['rev-parse', `${cutover}^`]);
  if (parent.code !== 0) return [];
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const parentRevision = parent.stdout.trim();
  const baseline = rawGateImplementPassEntries(gitText(root, parentRevision, specPath));
  const baselineCounts = entryCounts(gitText(root, parentRevision, specPath));
  const minimumCounts = new Map(baselineCounts);
  const previousCounts = new Map(baselineCounts);
  const reintroduced = new Set();
  const changed = runGit(root, [
    'rev-list',
    '--reverse',
    '--ancestry-path',
    `${parentRevision}..${revision}`,
    '--',
    specPath,
  ]);
  if (changed.code !== 0) {
    throw new Error(
      `cannot inspect legacy checkpoint occurrence ancestry: ${changed.stderr || '(no stderr)'}`,
    );
  }
  for (const commit of lines(changed.stdout)) {
    const counts = entryCounts(gitText(root, commit, specPath));
    for (const key of baselineCounts.keys()) {
      const count = counts.get(key) ?? 0;
      if (count > (previousCounts.get(key) ?? 0)) reintroduced.add(key);
      minimumCounts.set(key, Math.min(minimumCounts.get(key) ?? 0, count));
      previousCounts.set(key, count);
    }
  }
  const remaining = new Map(
    [...baselineCounts.keys()].map((key) => [
      key,
      reintroduced.has(key) ? 0 : (minimumCounts.get(key) ?? 0),
    ]),
  );
  return baseline.filter((entry) => {
    const key = entry.trimEnd();
    const count = remaining.get(key) ?? 0;
    if (count === 0) return false;
    remaining.set(key, count - 1);
    return true;
  });
}

export function checkpointIntroductionSpec(root, revision, basename, rawEntry) {
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const currentEntries = rawGateImplementPassEntries(gitText(root, revision, specPath));
  const selectedIndex = currentEntries.findIndex((entry) => entry === rawEntry);
  if (selectedIndex === -1) return null;
  const occurrence = currentEntries
    .slice(0, selectedIndex + 1)
    .filter((entry) => entry === rawEntry).length;
  const history = runGit(root, ['rev-list', '--first-parent', revision]);
  if (history.code !== 0) {
    throw new Error(
      `cannot inspect checkpoint introduction ancestry: ${history.stderr || '(no stderr)'}`,
    );
  }
  for (const commit of lines(history.stdout)) {
    const parent = runGit(root, ['rev-parse', `${commit}^1`]);
    const specText = gitText(root, commit, specPath);
    if (specText === null) continue;
    const inCommit = rawGateImplementPassEntries(specText).filter(
      (entry) => entry === rawEntry,
    ).length;
    const inParent =
      parent.code === 0
        ? rawGateImplementPassEntries(gitText(root, parent.stdout.trim(), specPath)).filter(
            (entry) => entry === rawEntry,
          ).length
        : 0;
    if (inCommit >= occurrence && inParent < occurrence) {
      return { commit, specText };
    }
  }
  return null;
}

export function precedingCheckpointIntegrationCommit(root, revision, basename) {
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const priorEntry = rawGateImplementPassEntries(gitText(root, revision, specPath)).at(-1);
  if (priorEntry === undefined) return null;
  const history = runGit(root, ['rev-list', '--first-parent', revision]);
  if (history.code !== 0) {
    throw new Error(
      `cannot inspect preceding integration ancestry: ${history.stderr || '(no stderr)'}`,
    );
  }
  for (const commit of lines(history.stdout)) {
    const parent = runGit(root, ['rev-parse', `${commit}^1`]);
    if (parent.code !== 0) continue;
    const inCommit = rawGateImplementPassEntries(gitText(root, commit, specPath)).filter(
      (entry) => entry === priorEntry,
    ).length;
    const inParent = rawGateImplementPassEntries(
      gitText(root, parent.stdout.trim(), specPath),
    ).filter((entry) => entry === priorEntry).length;
    if (inCommit > inParent) return commit;
  }
  return null;
}
