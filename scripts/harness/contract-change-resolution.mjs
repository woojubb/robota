import { spawnSync } from 'node:child_process';

import { normalizeContractPath } from './contract-input-matching.mjs';

function defaultRunGit(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

/** Parse `git diff --name-status -z`, retaining both sides of renames and copies. */
export function parseNameStatusDiff(output) {
  const tokens = String(output ?? '').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[ACDMRTUXB][0-9]*$/u.test(status ?? '')) {
      throw new Error(`unreadable git diff status: ${status || '<empty>'}`);
    }
    const count = /^[RC]/u.test(status) ? 2 : 1;
    for (let offset = 0; offset < count; offset += 1) {
      const file = normalizeContractPath(tokens[index++]);
      if (!file) throw new Error(`unreadable git diff path after ${status}`);
      files.push(file);
    }
  }
  return [...new Set(files)].sort();
}

/** Resolve a fail-closed changed-file set from every merge base. */
export function resolveChangedContractInputs({
  root,
  baseRef,
  headRef = 'HEAD',
  runGit = defaultRunGit,
}) {
  if (!baseRef || !headRef) return { ok: false, files: [], reason: 'base/head ref is missing' };
  const merge = runGit(['merge-base', '--all', baseRef, headRef], { cwd: root });
  if (merge?.status !== 0 || merge.signal) {
    return { ok: false, files: [], reason: 'merge-base lookup failed' };
  }
  const bases = String(merge.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (bases.length === 0) return { ok: false, files: [], reason: 'merge-base lookup was empty' };
  const files = new Set();
  try {
    for (const base of bases) {
      const diff = runGit(['diff', '--name-status', '-z', '-M', base, headRef], { cwd: root });
      if (diff?.status !== 0 || diff.signal) {
        return { ok: false, files: [], reason: `diff against ${base} failed` };
      }
      for (const file of parseNameStatusDiff(diff.stdout)) files.add(file);
    }
  } catch (error) {
    return { ok: false, files: [], reason: error.message };
  }
  if (files.size === 0) return { ok: false, files: [], reason: 'changed-file diff was empty' };
  return { ok: true, bases, files: [...files].sort() };
}
