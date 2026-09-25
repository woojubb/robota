/**
 * #3101 (B2): how another local session's workspace relates to this one's.
 *
 * A session publishes a workspace claim with its rendezvous entry. The reader does not take the
 * claim as written: it resolves the claimed path and reads git there itself, and a claim that
 * disagrees with what it finds is reported as mismatched and contributes nothing to the relation.
 * What this checks is the CONTENTS of the claimed path, not that the peer works there: both sessions
 * run as the same OS user, which is the trust boundary, and the relation grants nothing.
 *
 * The root-commit set is the strongest same-repository signal — it survives clones and forks — and
 * the origin URL is the fallback for a repository with no commits yet. The URL is published only as
 * a hash of its normalized form, so a credential embedded in a remote never lands in the rendezvous.
 *
 * Git runs here in directories this session did not choose — its own cwd before any workspace trust
 * decision, and paths named by peers — so every call is local-only: no lazy object fetch, no
 * transport, no hooks, no fsmonitor. Git that fails, for any reason, yields no claim rather than a
 * partial one.
 *
 * The relation is display and routing information. It is never an authorization input: a peer in
 * the same worktree is granted nothing a peer in another repository is not.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

import type { TWorkspaceRelation } from '@robota-sdk/agent-interface-session-mobility';

/** What a session publishes about its workspace. */
export interface IWorkspaceClaim {
  /** The real path of the worktree's top level. */
  readonly worktreePath: string;
  /** Root commits reachable from HEAD, sorted. Empty only in a repository with no commits. */
  readonly rootCommits: readonly string[];
  /** SHA-256 of the normalized `origin` URL, when there is one. */
  readonly originUrlHash?: string;
}

export interface IWorkspaceVerdict {
  readonly relation: TWorkspaceRelation;
  /** `absent`: nothing was claimed. `mismatched`: the claim was not believed. */
  readonly claim: 'verified' | 'mismatched' | 'absent';
}

/** Git's exit code and output, or undefined when it could not run to completion (timeout, signal). */
export type TRunGit = (
  cwd: string,
  args: readonly string[],
) => Promise<{ readonly code: number; readonly stdout: string } | undefined>;

const GIT_TIMEOUT_MS = 2_000;

/** Configuration that keeps a read local, whatever the repository's own config says. */
const LOCAL_ONLY = [
  '-c',
  'protocol.allow=never',
  '-c',
  'core.sshCommand=',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
];

const runGit: TRunGit = (cwd, args) => {
  // Inherited `GIT_*` variables (a hook's GIT_DIR, say) would make git answer about some other
  // repository than the one at `cwd`.
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  env.GIT_NO_LAZY_FETCH = '1';
  return new Promise((resolve) => {
    execFile(
      'git',
      [...LOCAL_ONLY, ...args],
      { cwd, env, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error === null) return resolve({ code: 0, stdout: stdout.trim() });
        const code = (error as { code?: unknown }).code;
        // A numeric code is git's own answer; anything else (spawn failure, timeout) is no answer.
        resolve(
          typeof code === 'number' && error.killed !== true
            ? { code, stdout: stdout.trim() }
            : undefined,
        );
      },
    );
  });
};

function realpath(target: string): string | undefined {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}

/** One spelling per remote: no scheme, credentials, port, trailing `.git` or slash; host lowercased. */
function normalizeOriginUrl(url: string): string {
  const trimmed = url.trim();
  const scpLike = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.*)$/.exec(trimmed);
  let host = '';
  let pathname = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && scpLike !== null) {
    host = scpLike[1] ?? '';
    pathname = scpLike[2] ?? '';
  } else {
    try {
      const parsed = new URL(trimmed);
      host = parsed.hostname;
      pathname = parsed.pathname;
    } catch {
      // allow-fallback: a local-path remote has no host; the path itself is the identity.
    }
  }
  const path = pathname
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+/, '');
  return `${host.toLowerCase()}/${path}`;
}

export function hashOriginUrl(url: string): string {
  return createHash('sha256').update(normalizeOriginUrl(url)).digest('hex');
}

/** The claim for the workspace containing `directory`, or undefined when git cannot say. */
export async function readWorkspaceClaim(
  directory: string,
  git: TRunGit = runGit,
): Promise<IWorkspaceClaim | undefined> {
  const start = realpath(directory);
  if (start === undefined) return undefined;
  const topLevel = await git(start, ['rev-parse', '--show-toplevel']);
  const worktreePath =
    topLevel?.code === 0 && topLevel.stdout ? realpath(topLevel.stdout) : undefined;
  if (worktreePath === undefined) return undefined;

  // Exit 1 with no output is an unborn HEAD: a repository with no commits, a real answer.
  const head = await git(worktreePath, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (head === undefined || (head.code !== 0 && !(head.code === 1 && head.stdout === ''))) {
    return undefined;
  }
  let rootCommits: string[] = [];
  if (head.code === 0) {
    const roots = await git(worktreePath, ['rev-list', '--max-parents=0', 'HEAD']);
    if (roots?.code !== 0 || roots.stdout === '') return undefined;
    rootCommits = roots.stdout.split(/\s+/).sort();
  }

  // Exit 1 is "no such key": a repository without an origin.
  const origin = await git(worktreePath, ['config', '--get', 'remote.origin.url']);
  if (origin === undefined || (origin.code !== 0 && origin.code !== 1)) return undefined;
  return {
    worktreePath,
    rootCommits,
    ...(origin.code === 0 && origin.stdout ? { originUrlHash: hashOriginUrl(origin.stdout) } : {}),
  };
}

function isClaim(value: unknown): value is IWorkspaceClaim {
  const claim = value as Partial<IWorkspaceClaim> | null;
  return (
    typeof claim === 'object' &&
    claim !== null &&
    typeof claim.worktreePath === 'string' &&
    Array.isArray(claim.rootCommits) &&
    claim.rootCommits.every((root) => typeof root === 'string') &&
    (claim.originUrlHash === undefined || typeof claim.originUrlHash === 'string')
  );
}

export function sameClaim(a: IWorkspaceClaim | undefined, b: IWorkspaceClaim | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.worktreePath === b.worktreePath &&
    a.originUrlHash === b.originUrlHash &&
    a.rootCommits.length === b.rootCommits.length &&
    a.rootCommits.every((root, index) => root === b.rootCommits[index])
  );
}

function relate(own: IWorkspaceClaim, peer: IWorkspaceClaim): TWorkspaceRelation {
  if (own.worktreePath === peer.worktreePath) return 'same-worktree';
  if (own.rootCommits.some((root) => peer.rootCommits.includes(root))) return 'same-repo';
  if (own.rootCommits.length > 0 && peer.rootCommits.length > 0) return 'different-repo';
  // A repository with no commits has no history to compare; the origin is all that is left.
  if (own.originUrlHash !== undefined && peer.originUrlHash !== undefined) {
    return own.originUrlHash === peer.originUrlHash ? 'same-repo' : 'different-repo';
  }
  return 'unknown';
}

/**
 * The relation between this session's workspace and a peer's claimed one.
 *
 * `claimed` is whatever the peer's entry carried, so it is typed `unknown`: a malformed claim is a
 * claim that did not check out, not an absent one.
 */
export async function judgeWorkspaceRelation(
  own: IWorkspaceClaim | undefined,
  claimed: unknown,
  read: (directory: string) => Promise<IWorkspaceClaim | undefined> = readWorkspaceClaim,
): Promise<IWorkspaceVerdict> {
  if (claimed === undefined) return { relation: 'unknown', claim: 'absent' };
  if (!isClaim(claimed)) return { relation: 'unknown', claim: 'mismatched' };
  const observed = await read(claimed.worktreePath);
  if (observed === undefined || !sameClaim(observed, claimed)) {
    return { relation: 'unknown', claim: 'mismatched' };
  }
  if (own === undefined) return { relation: 'unknown', claim: 'verified' };
  return { relation: relate(own, observed), claim: 'verified' };
}
