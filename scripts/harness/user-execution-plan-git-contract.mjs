import { spawnSync } from 'node:child_process';

import { envWithoutGitVars } from './shared.mjs';
import { parseUserExecutionPlanContract } from './user-execution-plan-contract.mjs';

const RULE_PATH = '.agents/rules/backlog-execution.md';

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

function gitText(root, revision, relativePath) {
  const result = runGit(root, ['show', `${revision}:${relativePath}`]);
  return result.code === 0 ? result.stdout : null;
}

function validAt(root, revision) {
  const text = gitText(root, revision, RULE_PATH);
  return text !== null && parseUserExecutionPlanContract(text).ok;
}

export function userExecutionPlanContractState(root, revision = 'HEAD') {
  const listed = runGit(root, ['rev-list', '--reverse', revision, '--', RULE_PATH]);
  if (listed.code !== 0) {
    throw new Error(
      `cannot inspect user-execution PLAN contract ancestry: ${listed.stderr || '(no stderr)'}`,
    );
  }
  const commits = lines(listed.stdout);
  const markerCommits = commits.filter((commit) =>
    String(gitText(root, commit, RULE_PATH) ?? '').includes('user-execution-plan-contract:v1:'),
  );
  const cutovers = commits.filter((commit) => {
    if (!validAt(root, commit)) return false;
    const parents = runGit(root, ['rev-list', '--parents', '-n', '1', commit]);
    if (parents.code !== 0) {
      throw new Error(
        `cannot inspect user-execution PLAN contract parents: ${parents.stderr || '(no stderr)'}`,
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

function changedSpecPaths(root, specRelative) {
  const dirty = runGit(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    specRelative,
  ]);
  return new Set(
    dirty.code === 0 ? lines(dirty.stdout).map((line) => line.slice(3).split(' -> ').at(-1)) : [],
  );
}

export function strictSpecContractContext(root, specRelative) {
  if (runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).code !== 0) {
    return { governed: false, changed: new Set(), producedBy: new Map(), postCutover: new Set() };
  }
  const changed = changedSpecPaths(root, specRelative);
  const state = userExecutionPlanContractState(root);
  if (state.valid && state.cutovers.length !== 1) {
    throw new Error(
      `user-execution PLAN contract cutover is ambiguous; expected one introduction, found ${state.cutovers.length}`,
    );
  }
  if (!state.valid) {
    if (state.cutovers.length > 0) {
      throw new Error('user-execution PLAN contract is missing or invalid after its cutover');
    }
    return { governed: false, changed, producedBy: new Map(), postCutover: new Set() };
  }
  const history = runGit(root, ['log', '--format=commit:%H', '--name-only', '--', specRelative]);
  if (history.code !== 0)
    throw new Error(`cannot inspect spec production ancestry: ${history.stderr}`);
  const producedBy = new Map();
  let commit = null;
  for (const line of history.stdout.split('\n')) {
    if (line.startsWith('commit:')) commit = line.slice('commit:'.length);
    else if (commit !== null && line.startsWith(`${specRelative}/`) && !producedBy.has(line)) {
      producedBy.set(line, commit);
    }
  }
  const descendants = runGit(root, ['rev-list', '--ancestry-path', `${state.cutovers[0]}..HEAD`]);
  if (descendants.code !== 0) {
    throw new Error(`cannot inspect post-cutover ancestry: ${descendants.stderr}`);
  }
  return {
    governed: true,
    changed,
    producedBy,
    postCutover: new Set([state.cutovers[0], ...lines(descendants.stdout)]),
  };
}

export function isStrictSpecContract(relativePath, context) {
  if (context.changed.has(relativePath)) return true;
  if (!context.governed) return false;
  const producedBy = context.producedBy.get(relativePath);
  return producedBy === undefined || context.postCutover.has(producedBy);
}
