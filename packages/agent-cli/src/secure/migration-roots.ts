/**
 * Which projects a `secure migrate` may write. Nothing registers the projects a state root
 * served, so the candidates come from what the state root remembers — the workspace-trust grants,
 * the working directory every user session record names (opened: the keys are unlocked), and the
 * project every prompt-history entry names. A candidate is only a candidate: it is written only when
 * the trust service says it is trusted now, its identity resolved again, on a host that can write
 * project state, and then only through the authority that service mints — never through a path a
 * record handed over. Every other root holding project state is listed with why it was left alone.
 * The trust store is only read here, never tightened, so planning changes nothing on disk.
 *
 * A candidate on a mount that no longer answers would hang the run, and a timed-out look through the
 * thread pool would keep one of its few threads forever. So the candidates are first probed, a few at
 * a time, each by a child process — git resolving its repository, which looks at the path, its real
 * path and its git identity, as the trust service is about to — and one that does not answer in time
 * is listed as unreachable and the child abandoned. Where git cannot be started at all, a candidate
 * is looked at through the thread pool instead, bounded by the same timeout: one at a time, and once
 * one has not answered — its thread is then held for good — every candidate left is listed as
 * unreachable rather than risk another. Only a candidate that answered is then looked at here. A
 * mount that stops answering between its probe and that look is not caught.
 */
import { spawn } from 'node:child_process';
import { lstatSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { endWithProcess, signalChildGroup, withChildSession } from '@robota-sdk/agent-core/node';
import {
  createNodeWorkspaceTrustStore,
  supportsWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework/node';
import {
  readPromptHistoryProjects,
  readSessionStoreWorkingDirectories,
} from '@robota-sdk/agent-session/node';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { BrokeredWorkspaceTrustService } from '../startup/brokered-workspace-trust.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceTrustStore,
  TWorkspaceTrustState,
} from '@robota-sdk/agent-framework';

const DEFAULT_STAT_TIMEOUT_MS = 2_000;
/** How many candidates are probed at once. */
const PROBE_CONCURRENCY = 4;

/** A project the migration writes, through the authority the trust service minted for it now. */
export interface ITrustedProjectRoot {
  readonly root: string;
  readonly authority: IWorkspaceProjectAuthority;
}

/** A root holding project state that the migration leaves alone, and why. */
export interface IListedProjectRoot {
  readonly root: string;
  readonly reason:
    | {
        readonly kind: 'not-trusted';
        readonly trustState: Exclude<TWorkspaceTrustState, 'trusted'>;
      }
    | { readonly kind: 'host-cannot-write' }
    | { readonly kind: 'unreachable' }
    | { readonly kind: 'below-workspace-root' }
    | { readonly kind: 'state-is-link' }
    | { readonly kind: 'trust-store-unreadable' };
}

export interface IProjectRoots {
  readonly trusted: readonly ITrustedProjectRoot[];
  readonly listed: readonly IListedProjectRoot[];
  /** Recorded working directories that no longer exist. */
  readonly vanished: number;
}

/**
 * Looks at `candidate` the way the trust service will, out of this process, settling once it has
 * answered; `signal` aborts when it is given up on. It rejects with
 * {@link CandidateProbeUnavailableError} when it cannot run at all.
 */
export type TCandidateProbe = (candidate: string, signal: AbortSignal) => Promise<void>;

/** Looks at `candidate` through this process's thread pool, settling once it has answered. */
export type TCandidateLook = (candidate: string) => Promise<void>;

/** The probe could not run at all (git could not be started), so it says nothing of the candidate. */
export class CandidateProbeUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The candidate probe could not be started.', { cause });
    this.name = 'CandidateProbeUnavailableError';
  }
}

export interface IDiscoverProjectRootsOptions {
  /** The platform whose project writes are judged; defaults to this one. */
  readonly platform?: NodeJS.Platform;
  /** How long the probe, or the look, of a candidate may take; defaults to two seconds. */
  readonly statTimeoutMs?: number;
  /** The probe; defaults to git resolving the candidate's repository in a child process. */
  readonly probe?: TCandidateProbe;
  /** The look used where the probe cannot run; defaults to `stat` and `realpath` of the candidate. */
  readonly look?: TCandidateLook;
}

type TLook = 'missing' | 'directory' | 'link' | 'other';
type TProbeAnswer = 'answered' | 'unanswered' | 'unavailable';

/**
 * git resolving `candidate`'s repository: it changes into the path (`-C`, so this process never does)
 * and walks up to its repository, as the identity resolver will. Settles when git ends, however it
 * ends — a path outside any repository answers too — and rejects with
 * {@link CandidateProbeUnavailableError} when git cannot be started at all. An abort kills git and
 * lets this process forget it.
 */
export const probeWithGit: TCandidateProbe = (candidate, signal) =>
  new Promise<void>((settle, fail) => {
    // git from PATH, on a candidate a repository may have planted: its own session in secure mode.
    const child = endWithProcess(
      spawn(
        'git',
        ['-C', candidate, 'rev-parse', '--show-toplevel', '--git-common-dir'],
        withChildSession({ stdio: 'ignore' }),
      ),
    );
    let started = false;
    child.once('spawn', () => {
      started = true;
    });
    child.once('exit', () => settle());
    child.once('error', (error) =>
      started ? settle() : fail(new CandidateProbeUnavailableError(error)),
    );
    signal.addEventListener(
      'abort',
      () => {
        signalChildGroup(child, 'SIGKILL');
        child.unref();
      },
      { once: true },
    );
  });

/** The default look: the candidate and its real path, through the thread pool. */
const lookThroughThreadPool: TCandidateLook = async (candidate) => {
  await stat(candidate);
  await realpath(candidate);
};

/** What `work` settles to, or `late` once `timeoutMs` has passed first. */
async function within<T>(work: Promise<T>, timeoutMs: number, late: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<T>((settle) => {
    timer = setTimeout(() => settle(late), timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** How `probe` answers for `candidate` within `timeoutMs`; a probe given up on is aborted. */
async function probeAnswer(
  candidate: string,
  probe: TCandidateProbe,
  timeoutMs: number,
): Promise<TProbeAnswer> {
  const controller = new AbortController();
  try {
    return await within<TProbeAnswer>(
      probe(candidate, controller.signal).then(
        () => 'answered',
        (error: unknown) =>
          error instanceof CandidateProbeUnavailableError ? 'unavailable' : 'answered',
      ),
      timeoutMs,
      'unanswered',
    );
  } finally {
    controller.abort();
  }
}

/** `answer` for every item, at most `limit` at a time, in the items' order. */
async function inPool<T, R>(
  items: readonly T[],
  limit: number,
  answer: (item: T) => Promise<R>,
): Promise<R[]> {
  const answers: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      answers[index] = await answer(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return answers;
}

/** What `path` is, by `stat` (`follow`) or `lstat`; only for a candidate that answered. */
function look(path: string, follow: boolean): TLook {
  try {
    const metadata = follow ? statSync(path) : lstatSync(path);
    return metadata.isSymbolicLink() ? 'link' : metadata.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'other';
  }
}

/** Every candidate root the state root remembers, distinct, with a listing for a trust store that does not read. */
async function candidates(
  runtime: ICliRuntimeContext,
  store: IWorkspaceTrustStore,
  sealer: IArtifactSealer,
  listed: IListedProjectRoot[],
): Promise<string[]> {
  const paths = new Set<string>();
  try {
    for (const grant of (await store.listGrants?.()) ?? []) paths.add(grant.worktreeRoot);
  } catch {
    // allow-fallback: an unreadable trust store grants nothing; it is listed, and the run goes on.
    listed.push({
      root: runtime.layout.userPaths.workspaceTrust,
      reason: { kind: 'trust-store-unreadable' },
    });
  }
  for (const cwd of readSessionStoreWorkingDirectories(runtime.layout.userPaths.sessions, {
    sealer,
  })) {
    paths.add(cwd);
  }
  for (const project of readPromptHistoryProjects(runtime.layout.userPaths.history, { sealer })) {
    paths.add(project);
  }
  // Every writer records an absolute path; anything else would be read against this process's cwd.
  return [...paths].filter((path) => isAbsolute(path)).map((path) => resolve(path));
}

/** The project roots a migration writes and the ones it lists, as the module documentation describes. */
export async function discoverProjectRoots(
  runtime: ICliRuntimeContext,
  sealer: IArtifactSealer,
  options: IDiscoverProjectRootsOptions = {},
): Promise<IProjectRoots> {
  const timeoutMs = options.statTimeoutMs ?? DEFAULT_STAT_TIMEOUT_MS;
  const probe = options.probe ?? probeWithGit;
  const lookFallback = options.look ?? lookThroughThreadPool;
  const store = createNodeWorkspaceTrustStore(runtime.layout.userPaths.workspaceTrust, {
    tightenOnRead: false,
  });
  const service = await BrokeredWorkspaceTrustService.create(runtime);
  const projectDirectory = runtime.layout.projectDirectory;
  const trusted: ITrustedProjectRoot[] = [];
  const listed: IListedProjectRoot[] = [];
  const seen = new Set<string>();
  let vanished = 0;
  const remembered = await candidates(runtime, store, sealer, listed);
  const probed = await inPool(remembered, PROBE_CONCURRENCY, (candidate) =>
    probeAnswer(candidate, probe, timeoutMs),
  );
  let lookHung = false;
  for (const [index, candidate] of remembered.entries()) {
    let reachable = probed[index] === 'answered';
    if (probed[index] === 'unavailable' && !lookHung) {
      reachable = await within(
        lookFallback(candidate).then(
          () => true,
          () => true,
        ),
        timeoutMs,
        false,
      );
      lookHung = !reachable;
    }
    if (!reachable) {
      listed.push({ root: candidate, reason: { kind: 'unreachable' } });
      continue;
    }
    const found = look(candidate, true);
    if (found === 'missing') vanished += 1;
    if (found !== 'directory') continue;
    const access = await service.inspect(candidate);
    const root = access.identity?.worktreeRoot ?? candidate;
    // An older build kept project state at the working directory, below the workspace root; the
    // authority covers the root's own state directory only, so that one is listed, never written.
    if (root !== candidate && look(join(candidate, projectDirectory), false) === 'directory') {
      listed.push({ root: candidate, reason: { kind: 'below-workspace-root' } });
    }
    if (seen.has(root)) continue;
    seen.add(root);
    const state = look(join(root, projectDirectory), false);
    if (state === 'missing' || state === 'other') continue;
    if (state === 'link') listed.push({ root, reason: { kind: 'state-is-link' } });
    else if (access.status !== 'trusted') {
      listed.push({ root, reason: { kind: 'not-trusted', trustState: access.trustState } });
    } else if (!supportsWorkspaceProjectMutation(options.platform)) {
      listed.push({ root, reason: { kind: 'host-cannot-write' } });
    } else {
      trusted.push({ root, authority: access.authority });
    }
  }
  return { trusted, listed, vanished };
}
