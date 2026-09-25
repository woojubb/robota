/**
 * #3101 (B2): how another local session's workspace relates to this one's.
 *
 * A session publishes a workspace claim with its rendezvous entry. The claim is VERIFIED, not
 * trusted: both sessions run as the same OS user on the same host, so the reader can resolve the
 * claimed path and read git there itself, and does. A claim that disagrees with what the reader
 * finds is reported as mismatched and contributes nothing to the relation.
 *
 * The root-commit set is the strongest same-repository signal — it survives clones and forks — and
 * the origin URL is the fallback for a repository with no commits yet. The URL is published only as
 * a hash of its normalized form, so a credential embedded in a remote never lands in the rendezvous.
 *
 * The relation is display and routing information. It is never an authorization input: a peer in
 * the same worktree is granted nothing a peer in another repository is not.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

import type { TWorkspaceRelation } from '@robota-sdk/agent-interface-session-mobility';

/** What a session publishes about its workspace. */
export interface IWorkspaceClaim {
  /** The real path of the worktree's top level. */
  readonly worktreePath: string;
  /** Root commits reachable from HEAD, sorted. Empty in a repository with no commits. */
  readonly rootCommits: readonly string[];
  /** SHA-256 of the normalized `origin` URL, when there is one. */
  readonly originUrlHash?: string;
}

export interface IWorkspaceVerdict {
  readonly relation: TWorkspaceRelation;
  /** `absent`: nothing was claimed. `mismatched`: the claim was not believed. */
  readonly claim: 'verified' | 'mismatched' | 'absent';
}

/** Runs git in `cwd`; undefined when git fails or is missing. */
export type TRunGit = (cwd: string, args: readonly string[]) => string | undefined;

const GIT_TIMEOUT_MS = 2_000;

function runGit(cwd: string, args: readonly string[]): string | undefined {
  // Inherited `GIT_*` variables (a hook's GIT_DIR, say) would make git answer about some other
  // repository than the one at `cwd`.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // allow-fallback: undefined means "git could not say", which callers map to no claim.
    return undefined;
  }
}

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

/** The claim for the workspace containing `directory`, or undefined when it is not in git. */
export function readWorkspaceClaim(
  directory: string,
  git: TRunGit = runGit,
): IWorkspaceClaim | undefined {
  const start = realpath(directory);
  if (start === undefined) return undefined;
  const topLevel = git(start, ['rev-parse', '--show-toplevel']);
  const worktreePath = topLevel ? realpath(topLevel) : undefined;
  if (worktreePath === undefined) return undefined;
  const roots = git(worktreePath, ['rev-list', '--max-parents=0', 'HEAD']);
  const origin = git(worktreePath, ['config', '--get', 'remote.origin.url']);
  return {
    worktreePath,
    rootCommits: roots ? roots.split(/\s+/).sort() : [],
    ...(origin ? { originUrlHash: hashOriginUrl(origin) } : {}),
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

function sameClaim(a: IWorkspaceClaim, b: IWorkspaceClaim): boolean {
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
export function judgeWorkspaceRelation(
  own: IWorkspaceClaim | undefined,
  claimed: unknown,
  read: (directory: string) => IWorkspaceClaim | undefined = readWorkspaceClaim,
): IWorkspaceVerdict {
  if (claimed === undefined) return { relation: 'unknown', claim: 'absent' };
  if (!isClaim(claimed)) return { relation: 'unknown', claim: 'mismatched' };
  const observed = read(claimed.worktreePath);
  if (observed === undefined || !sameClaim(observed, claimed)) {
    return { relation: 'unknown', claim: 'mismatched' };
  }
  if (own === undefined) return { relation: 'unknown', claim: 'verified' };
  return { relation: relate(own, observed), claim: 'verified' };
}
