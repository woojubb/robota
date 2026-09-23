import { spawnSync } from 'node:child_process';

export const normalizeWorkspacePath = (value) =>
  String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/+$/u, '');

function runGitDefault(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

/** Parse `git diff --name-status -z`, preserving both old and new sides of renames/copies. */
export function parseNameStatusDiff(output) {
  const tokens = String(output ?? '').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[ACDMRTUXB][0-9]*$/u.test(status ?? '')) {
      throw new Error(`unreadable git diff status: ${status || '<empty>'}`);
    }
    const pathCount = /^[RC]/u.test(status) ? 2 : 1;
    for (let offset = 0; offset < pathCount; offset += 1) {
      const file = normalizeWorkspacePath(tokens[index++]);
      if (!file) throw new Error(`unreadable git diff path after ${status}`);
      files.push(file);
    }
  }
  return [...new Set(files)].sort();
}

function parseNulPaths(output) {
  return String(output ?? '')
    .split('\0')
    .map(normalizeWorkspacePath)
    .filter(Boolean);
}

/** Resolve committed changes plus local mutable state outside CI. */
export function resolveChangedFiles({
  root,
  baseRef,
  headRef = 'HEAD',
  runGit = runGitDefault,
  environment = process.env,
}) {
  if (!baseRef || !headRef) return { ok: false, reason: 'base/head ref is missing', files: [] };
  const merge = runGit(['merge-base', '--all', baseRef, headRef], { cwd: root });
  if (merge?.status !== 0 || merge?.signal) {
    return { ok: false, reason: 'merge-base lookup failed', files: [] };
  }
  const mergeBases = String(merge.stdout ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  if (mergeBases.length === 0) {
    return { ok: false, reason: 'merge-base lookup was empty', files: [] };
  }

  const files = new Set();
  try {
    for (const mergeBase of mergeBases) {
      const diff = runGit(['diff', '--name-status', '-z', '-M', '-C', mergeBase, headRef], {
        cwd: root,
      });
      if (diff?.status !== 0 || diff?.signal) {
        return { ok: false, reason: `diff against ${mergeBase} failed`, files: [] };
      }
      for (const file of parseNameStatusDiff(diff.stdout)) files.add(file);
    }
    if (!environment.CI && !environment.GITHUB_ACTIONS) {
      for (const [label, args] of [
        ['staged', ['diff', '--name-status', '-z', '-M', '-C', '--cached']],
        ['unstaged', ['diff', '--name-status', '-z', '-M', '-C']],
      ]) {
        const diff = runGit(args, { cwd: root });
        if (diff?.status !== 0 || diff?.signal) {
          return { ok: false, reason: `${label} diff failed`, files: [] };
        }
        for (const file of parseNameStatusDiff(diff.stdout)) files.add(file);
      }
      const untracked = runGit(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root });
      if (untracked?.status !== 0 || untracked?.signal) {
        return { ok: false, reason: 'untracked-file lookup failed', files: [] };
      }
      for (const file of parseNulPaths(untracked.stdout)) files.add(file);
    }
  } catch (error) {
    return { ok: false, reason: error.message, files: [] };
  }

  if (files.size === 0) return { ok: false, reason: 'changed-file diff was empty', files: [] };
  return { ok: true, mergeBases, files: [...files].sort() };
}
