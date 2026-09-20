/**
 * FLOW-2006: turn a parsed launch intent into a directory the session may actually start in.
 *
 * The rule the whole feature rests on: a link opens only what the user has ALREADY trusted. The
 * premise that this could reuse an existing interactive trust gate was false — `workspace-trust-
 * admission.ts` is the headless gate, guarded by `printMode || goal || serve`, and the TUI has no
 * trust decision point at all, so an untrusted directory would otherwise open silently in restricted
 * mode. Refusing is the safe direction until that gap is closed.
 *
 * Contained — TRUST-1989.
 */
import type { IGitProcessPort } from '@robota-sdk/agent-command';
import type { IWorkspaceTrustGrant } from '@robota-sdk/agent-framework';

import type { ILaunchIntent } from './launch-intent.js';

export type TLaunchTargetTrust = 'trusted' | 'untrusted' | 'revoked' | 'stale/replaced' | 'unknown';

export interface IResolveLaunchTargetDeps {
  /** Every recorded grant, or `undefined` when the store cannot enumerate them. */
  listGrants: () => Promise<readonly IWorkspaceTrustGrant[] | undefined>;
  /** The trust state of one directory, as the store reports it today. */
  inspectTrust: (cwd: string) => Promise<TLaunchTargetTrust>;
  /** Real path of an existing directory; `undefined` when it is missing or not a directory. */
  realDirectory: (cwd: string) => string | undefined;
  /** `git -C <root> config --get remote.origin.url`, or `undefined` when there is none. */
  readRemoteUrl: (root: string) => Promise<string | undefined>;
  /** Whether the root's `.git` is a directory — i.e. it is the repository's MAIN worktree. */
  isMainWorktree: (root: string) => boolean;
}

export type TResolveLaunchTarget =
  { readonly ok: true; readonly cwd: string } | { readonly ok: false; readonly reason: string };

/** `git@host:owner/name.git` and `https://host/owner/name(.git)` both reduce to `owner/name`. */
export function remoteSlug(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');
  const ssh = /^[^@\s]+@[^:\s]+:(?<owner>[^/\s]+)\/(?<name>[^/\s]+)$/u.exec(trimmed);
  if (ssh?.groups) return `${ssh.groups['owner']}/${ssh.groups['name']}`;
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+)$/iu.exec(trimmed);
  if (url?.groups) return `${url.groups['owner']}/${url.groups['name']}`;
  return undefined;
}

function refuse(reason: string): TResolveLaunchTarget {
  return { ok: false, reason };
}

/** The trust check every resolved target passes, whichever key named it. */
async function requireTrusted(
  cwd: string,
  deps: IResolveLaunchTargetDeps,
): Promise<TResolveLaunchTarget> {
  let state: TLaunchTargetTrust;
  try {
    state = await deps.inspectTrust(cwd);
  } catch (error) {
    return refuse(
      `the workspace trust state of ${cwd} could not be read (${String(error)}); the link is refused rather than opened unchecked.`,
    );
  }
  if (state === 'trusted') return { ok: true, cwd };
  return refuse(
    `${cwd} is not a trusted workspace (${state}). A link opens only what you have already trusted — run \`robota trust --yes\` there first.`,
  );
}

/** Resolve `repo=owner/name` among trusted grants, grouping a repository's worktrees as one. */
async function resolveRepo(
  slug: string,
  deps: IResolveLaunchTargetDeps,
): Promise<TResolveLaunchTarget> {
  let grants: readonly IWorkspaceTrustGrant[] | undefined;
  try {
    grants = await deps.listGrants();
  } catch (error) {
    return refuse(`the workspace trust store could not be read (${String(error)}).`);
  }
  if (grants === undefined) {
    return refuse(
      'this host cannot list workspace trust grants, so `repo=` cannot be resolved; open the link with `cwd=` instead.',
    );
  }

  const byRepository = new Map<string, string[]>();
  for (const grant of grants) {
    if (grant.state !== 'trusted') continue;
    const remote = await deps.readRemoteUrl(grant.worktreeRoot);
    // A clone with no origin simply cannot answer a slug; skipping it is not a failure.
    if (remote === undefined || remoteSlug(remote) !== slug) continue;
    const roots = byRepository.get(grant.repositoryKey) ?? [];
    roots.push(grant.worktreeRoot);
    byRepository.set(grant.repositoryKey, roots);
  }

  if (byRepository.size === 0) {
    return refuse(
      `no trusted local clone of \`${slug}\` is recorded. Open the link with \`cwd=<absolute path>\`, or run \`robota\` in that clone and trust it first.`,
    );
  }
  if (byRepository.size > 1) {
    const candidates = [...byRepository.values()].flat().join(', ');
    return refuse(`\`${slug}\` matches more than one trusted repository: ${candidates}.`);
  }

  const roots = [...byRepository.values()][0] ?? [];
  // Several worktrees of ONE repository are not an ambiguity: the main worktree is the answer.
  const main = roots.find((root) => deps.isMainWorktree(root));
  if (main === undefined) {
    return refuse(
      `\`${slug}\` resolves only to linked worktrees, with no main worktree among the trusted ones; open the link with \`cwd=\` to say which.`,
    );
  }
  return requireTrusted(main, deps);
}

/** Resolve the intent's target, or refuse naming why. Never clones, never fetches. */
export async function resolveLaunchTarget(
  intent: ILaunchIntent,
  deps: IResolveLaunchTargetDeps,
): Promise<TResolveLaunchTarget> {
  if (intent.cwd !== undefined) {
    const real = deps.realDirectory(intent.cwd);
    if (real === undefined) {
      return refuse(`${intent.cwd} does not exist or is not a directory.`);
    }
    return requireTrusted(real, deps);
  }
  if (intent.repo !== undefined) return resolveRepo(intent.repo, deps);
  return refuse('the link names no target.');
}

/** The argv a remote-url read uses, so the caller composes the git port rather than a new runner. */
export function remoteUrlArgs(): readonly string[] {
  return ['config', '--get', 'remote.origin.url'];
}

/** Read `origin` through the BEHAVIOR-2437 git port; `undefined` when the clone has no origin. */
export function createRemoteUrlReader(
  port: IGitProcessPort,
): (root: string) => Promise<string | undefined> {
  return async (root) => {
    const outcome = await port.run(remoteUrlArgs(), { cwd: root, timeoutMs: 10_000 });
    if (outcome.kind !== 'exited' || outcome.exitCode !== 0) return undefined;
    const value = outcome.stdout.trim();
    return value.length > 0 ? value : undefined;
  };
}
