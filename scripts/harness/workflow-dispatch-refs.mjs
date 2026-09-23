import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkflowDispatchCommitPair } from './git-base-ref-resolution.mjs';

function runGit(command, args, options) {
  return spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run from the immutable workflow controller checkout, before checking out the requested head. */
export function main({
  env = process.env,
  cwd = process.cwd(),
  runCommand = runGit,
  append = appendFileSync,
} = {}) {
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is unavailable');
  const { baseOid, headOid } = resolveWorkflowDispatchCommitPair({
    baseRef: env.BASE_REF,
    headRef: env.HEAD_REF,
    cwd,
    runCommand,
  });
  const mergeBase = runCommand('git', ['merge-base', baseOid, headOid], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  if (
    mergeBase.error ||
    mergeBase.signal ||
    mergeBase.status !== 0 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})\n$/u.test(mergeBase.stdout ?? '')
  ) {
    throw new Error('workflow dispatch base and head have no resolvable merge base');
  }
  append(env.GITHUB_OUTPUT, `base_oid=${baseOid}\nhead_oid=${headOid}\n`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
