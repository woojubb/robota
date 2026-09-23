/**
 * BEHAVIOR-2437: `/git diff` — a closed grammar, not a pass-through for git flags.
 *
 * `/git diff` (unstaged) · `/git diff --staged` (index vs HEAD) · `/git diff <rev>` (worktree vs rev)
 * · `/git diff <a>..<b>` (two revisions), each optionally followed by `-- <path>…`. Every revision is
 * verified with `rev-parse --verify --quiet --end-of-options <rev>^{commit}` before any diff runs;
 * any other `-` token is refused, because a flag is exactly how an argv element becomes an option.
 * In the argv git receives, `--end-of-options` precedes every user revision and `--` every path.
 */
import { gitFailureMessage } from './git-process.js';

import type { IGitProcessPort } from './git-process.js';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export const GIT_DIFF_USAGE =
  'Usage: /git diff [--staged | <rev> | <a>..<b>] [-- <path> ...] — other git flags are not accepted here.';

export type TGitDiffTarget =
  | { kind: 'worktree' }
  | { kind: 'staged' }
  | { kind: 'revision'; revision: string }
  | { kind: 'range'; from: string; to: string };

export interface IGitDiffArgs {
  target: TGitDiffTarget;
  paths: readonly string[];
}

export type TParseGitDiffArgs = { ok: true; args: IGitDiffArgs } | { ok: false; message: string };

function refuse(reason: string): TParseGitDiffArgs {
  return { ok: false, message: `${reason}\n${GIT_DIFF_USAGE}` };
}

export function parseGitDiffArgs(tokens: readonly string[]): TParseGitDiffArgs {
  const separator = tokens.indexOf('--');
  const head = separator === -1 ? tokens : tokens.slice(0, separator);
  const paths = separator === -1 ? [] : tokens.slice(separator + 1);
  if (separator !== -1 && paths.length === 0) return refuse('`--` must be followed by a path.');

  const flag = head.find((token) => token.startsWith('-') && token !== '--staged');
  if (flag !== undefined) return refuse(`\`${flag}\` is not accepted.`);
  if (head.length > 1) return refuse(`Too many arguments: ${head.join(' ')}.`);

  const token = head[0];
  if (token === undefined) return { ok: true, args: { target: { kind: 'worktree' }, paths } };
  if (token === '--staged') return { ok: true, args: { target: { kind: 'staged' }, paths } };
  if (token.includes('..')) {
    if (token.includes('...')) return refuse(`\`${token}\` is not a \`<a>..<b>\` range.`);
    const parts = token.split('..');
    const [from, to] = parts;
    if (parts.length !== 2 || !from || !to) {
      return refuse(`\`${token}\` is not a \`<a>..<b>\` range.`);
    }
    return { ok: true, args: { target: { kind: 'range', from, to }, paths } };
  }
  return { ok: true, args: { target: { kind: 'revision', revision: token }, paths } };
}

/** The revisions a target names, in the order they are verified. */
function revisionsOf(target: TGitDiffTarget): readonly string[] {
  switch (target.kind) {
    case 'revision':
      return [target.revision];
    case 'range':
      return [target.from, target.to];
    default:
      return [];
  }
}

/** The `diff` argv for a parsed target, `--end-of-options` before revisions and `--` before paths. */
export function gitDiffArgv(args: IGitDiffArgs): readonly string[] {
  const argv = ['diff'];
  switch (args.target.kind) {
    case 'staged':
      argv.push('--staged');
      break;
    case 'revision':
      argv.push('--end-of-options', args.target.revision);
      break;
    case 'range':
      argv.push('--end-of-options', `${args.target.from}..${args.target.to}`);
      break;
    default:
      break;
  }
  if (args.paths.length > 0) argv.push('--', ...args.paths);
  return argv;
}

function gitRevParseArgv(revision: string): readonly string[] {
  return ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`];
}

function tokenizeGitArgs(args: string): string[] {
  return args.split(/\s+/).filter((token) => token.length > 0);
}

export async function executeGitDiff(
  port: IGitProcessPort,
  cwd: string,
  args: string,
): Promise<ICommandResult> {
  const parsed = parseGitDiffArgs(tokenizeGitArgs(args));
  if (!parsed.ok) return { success: false, message: parsed.message };

  for (const revision of revisionsOf(parsed.args.target)) {
    const outcome = await port.run(gitRevParseArgv(revision), { cwd });
    if (outcome.kind === 'failed') {
      return { success: false, message: gitFailureMessage('rev-parse', outcome) ?? 'git failed' };
    }
    if (outcome.exitCode !== 0) {
      return { success: false, message: `Unknown revision: ${revision}` };
    }
  }

  const outcome = await port.run(gitDiffArgv(parsed.args), { cwd });
  const failure = gitFailureMessage('diff', outcome);
  if (failure !== undefined || outcome.kind !== 'exited') {
    return { success: false, message: failure ?? 'git diff failed' };
  }
  const diff = outcome.stdout.replace(/\n$/, '');
  return {
    success: true,
    message: diff.length > 0 ? diff : 'No differences.',
    data: { git: 'diff', target: parsed.args.target, paths: parsed.args.paths },
  };
}
