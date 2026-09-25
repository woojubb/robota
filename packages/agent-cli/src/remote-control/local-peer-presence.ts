/**
 * PEER-004 (#1863) — the composition leaf that makes this session discoverable, and reads the others.
 *
 * The rendezvous directory (#1810/#1862) and the registry (#1863) were both built and called by
 * nothing: measured on this tree before this file existed, no source outside those modules and their
 * tests referenced `announcePeer` or `openLocalPeerRendezvous`. A discovery layer nobody can reach is
 * one nobody can catch being wrong, so this is the piece that turns two landed leaves into behaviour.
 *
 * ## Withdrawal is bound to the process ending, not to a timeout
 *
 * A crashed session leaves its entry behind, which is why the registry settles liveness by pid AND
 * process start time rather than by a staleness window. That check is the floor, not the plan: a
 * session that exits normally removes its own entry, so the common case never depends on the floor
 * at all. `revokeRendezvousOnExit` already established this shape for grants; withdrawal takes the
 * same one, and for the same reason — leaning on the detector instead would make every clean exit
 * look like a crash until something else noticed.
 */

import {
  announcePeer,
  listPeers,
  withdrawPeer,
  type IDiscoveredPeer,
  type IPeerEntry,
  type IRegistryOptions,
} from './local-peer-registry.js';
import { ensureRendezvousDirectory } from './local-peer-rendezvous.js';
import {
  judgeWorkspaceRelation,
  readWorkspaceClaim,
  sameClaim,
  type IWorkspaceClaim,
  type IWorkspaceVerdict,
} from './local-peer-workspace.js';

import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';

/**
 * The summary shape, DERIVED from the port rather than imported beside it.
 *
 * The framework's root barrel is at its frozen size (ARCH-038, #1806) and pre-existing debt may
 * shrink but never grow, so two more re-export lines are not available. Deriving costs nothing in
 * coupling — this module must satisfy that exact port anyway — and it is stricter than a second
 * import would be: the type cannot drift from the adapter it feeds, because it IS the adapter's.
 */
type TPeerSummary = ReturnType<NonNullable<ICommandHostAdapters['localPeers']>['list']>[number];
const SECOND_MS = 1_000;
const CERTIFICATION_RETRY_MS = 5_000;

export interface ILocalPeerPresence {
  readonly sessionId: string;
  /**
   * The verified directory this session was announced into.
   *
   * Carried so the messaging leaf binds its socket in the SAME directory the announcement was
   * admitted against. Re-deriving it there would be a second answer to "which directory is ours",
   * and the whole same-user-same-host argument rests on there being one.
   */
  readonly guardedDirectory: string;
  /** Every announced session, this one included. Cheap: no workspace is read. */
  list(): readonly TPeerSummary[];
  /** The same rows, with each other live peer's workspace relation as this session judged it. */
  listWithWorkspace(): Promise<readonly TPeerSummary[]>;
  /** One peer's workspace verdict; undefined for this session, a dead entry or an unknown id. */
  relate(sessionId: string): Promise<IWorkspaceVerdict | undefined>;
  /** Re-read this session's own workspace claim, republishing when it changed. */
  refreshWorkspace(): Promise<void>;
  /** Publish fixed activity metadata; undefined clears it during a session switch. */
  publishStatus(status: IPeerEntry['status']): void;
  /** Remove this session's entry and stop listening for the exit. Idempotent. */
  withdraw(): void;
}

export interface IPresenceOptions {
  readonly sessionId: string;
  readonly name?: string;
  /** Injected so a case can drive the exit path without ending the test runner. */
  readonly on?: (event: 'exit', handler: () => void) => void;
  readonly off?: (event: 'exit', handler: () => void) => void;
  readonly registry?: Pick<
    IRegistryOptions,
    'readStartTime' | 'startTimePrecision' | 'probePid' | 'now'
  >;
  /** Injected so a case can point at a scratch directory instead of the real rendezvous. */
  readonly guardedDirectory?: string;
  /** Where this session works, for its workspace claim. Defaults to the process cwd. */
  readonly workspaceDirectory?: string;
}

/**
 * The verified directory, or throw.
 *
 * `binding` is present ONLY when admission held — the leaf that produces it says so, and says why:
 * absent is not "unknown but probably fine". Reading a directory out of a REFUSED admission would
 * undo that design one call site away, so the refusal is re-raised with the reason the guard gave.
 */
function resolveGuardedDirectory(): string {
  const admission = ensureRendezvousDirectory();
  if (!admission.admitted || admission.binding === undefined) {
    throw new Error(
      'local peer presence: the rendezvous directory was not admitted, so this session cannot be ' +
        `announced as same-user-same-host. ${admission.reason ?? 'No reason was given.'}`,
    );
  }
  return admission.binding.guardedDirectory;
}

/** A second-granularity birth time becomes trustworthy only after its owner republishes later. */
function scheduleBirthSecondCertification(
  registry: IRegistryOptions,
  republish: (requireStartTime: boolean) => IPeerEntry,
  initial: IPeerEntry,
  isWithdrawn: () => boolean,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let warned = false;
  const warnOnce = (reason: string): void => {
    if (warned) return;
    warned = true;
    process.emitWarning(`Local peer liveness certification delayed: ${reason}`);
  };
  const schedule = (delay: number): void => {
    timer = setTimeout(() => {
      if (isWithdrawn()) return;
      try {
        certify(republish(true));
      } catch (error) {
        warnOnce(error instanceof Error ? error.message : String(error));
        schedule(CERTIFICATION_RETRY_MS);
      }
    }, delay);
    timer.unref?.();
  };
  const certify = (entry: IPeerEntry): void => {
    if (entry.startTimePrecision !== 'seconds') return;
    const birth = entry.startSecondMs;
    if (typeof birth !== 'number') {
      warnOnce('The process birth second is unavailable.');
      schedule(CERTIFICATION_RETRY_MS);
      return;
    }
    if (entry.announcedAt >= birth + SECOND_MS) return;
    const delay = Math.max(
      1,
      Math.min(SECOND_MS, birth + SECOND_MS + 1 - (registry.now ?? Date.now)()),
    );
    schedule(delay);
  };
  certify(initial);
  return () => {
    if (timer) clearTimeout(timer);
  };
}

/**
 * Announce this session and return the reader for the rest.
 *
 * A failure to establish the guarded directory is NOT swallowed. The directory's permissions are the
 * whole security argument for treating an entry as same-user-same-host, so a presence that could not
 * verify them is not a degraded presence — it is a claim nobody checked, and announcing anyway would
 * publish this session into a place the guard never approved.
 */
export function announceLocalPeerPresence(options: IPresenceOptions): ILocalPeerPresence {
  const guardedDirectory = options.guardedDirectory ?? resolveGuardedDirectory();
  const registry: IRegistryOptions = { guardedDirectory, ...options.registry };
  const announcement = {
    sessionId: options.sessionId,
    ...(options.name !== undefined ? { name: options.name } : {}),
  };

  let withdrawn = false;
  let status: IPeerEntry['status'];
  // Read off the announcing path: git may be slow, and announcing must not wait on it.
  let workspace: IWorkspaceClaim | undefined;
  const republish = (requireStartTime = false): IPeerEntry =>
    announcePeer(registry, {
      ...announcement,
      ...(workspace !== undefined ? { workspace } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(requireStartTime ? { requireStartTime: true } : {}),
    });
  const stopCertification = scheduleBirthSecondCertification(
    registry,
    republish,
    republish(),
    () => withdrawn,
  );

  // The claim is re-read rather than fixed at start: a first commit, a checkout or a new origin
  // would otherwise leave an honest peer looking mismatched for the rest of its life.
  let refreshing: Promise<void> | undefined;
  const refreshWorkspace = (): Promise<void> => {
    refreshing ??= readWorkspaceClaim(options.workspaceDirectory ?? process.cwd())
      .then((next) => {
        if (withdrawn || sameClaim(next, workspace)) return;
        workspace = next;
        republish();
      })
      .catch((error: unknown) => {
        process.emitWarning(`Local peer workspace refresh failed: ${String(error)}`);
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  void refreshWorkspace();

  const heartbeat = setInterval(() => {
    if (withdrawn) return;
    void refreshWorkspace();
    if (status === undefined) return;
    try {
      republish(true);
    } catch (error) {
      process.emitWarning(`Local peer status refresh failed: ${String(error)}`);
    }
  }, 10_000);
  heartbeat.unref?.();
  const handler = (): void => {
    if (withdrawn) return;
    withdrawn = true;
    stopCertification();
    clearInterval(heartbeat);
    withdrawPeer(registry, options.sessionId);
  };
  const on = options.on ?? ((event, listener) => process.on(event, listener));
  on('exit', handler);

  const summarize = (discovered: IDiscoveredPeer, verdict?: IWorkspaceVerdict): TPeerSummary => ({
    sessionId: discovered.entry.sessionId,
    ...(discovered.entry.name !== undefined ? { name: discovered.entry.name } : {}),
    liveness: discovered.liveness,
    status: discovered.status,
    ...(verdict !== undefined
      ? { workspaceRelation: verdict.relation, workspaceClaim: verdict.claim }
      : {}),
  });

  // Keyed by the entry's own announcement and both claims, so a republish or a change on either
  // side is judged afresh and nothing else is.
  const verdicts = new Map<string, { key: string; verdict: Promise<IWorkspaceVerdict> }>();
  const judge = (discovered: IDiscoveredPeer): Promise<IWorkspaceVerdict> | undefined => {
    // Neither this session nor debris is judged: an entry whose process is gone relates to nothing.
    if (discovered.entry.sessionId === options.sessionId || discovered.liveness === 'dead') {
      return undefined;
    }
    const key = JSON.stringify([
      discovered.entry.announcedAt,
      discovered.entry.workspace ?? null,
      workspace ?? null,
    ]);
    const cached = verdicts.get(discovered.entry.sessionId);
    if (cached?.key === key) return cached.verdict;
    const verdict = judgeWorkspaceRelation(workspace, discovered.entry.workspace);
    verdicts.set(discovered.entry.sessionId, { key, verdict });
    return verdict;
  };

  return {
    sessionId: options.sessionId,
    guardedDirectory,
    list: () => listPeers(registry).map((discovered) => summarize(discovered)),
    listWithWorkspace: () =>
      Promise.all(
        listPeers(registry).map(async (discovered) =>
          summarize(discovered, await judge(discovered)),
        ),
      ),
    relate: async (sessionId) => {
      const discovered = listPeers(registry).find((peer) => peer.entry.sessionId === sessionId);
      return discovered === undefined ? undefined : judge(discovered);
    },
    refreshWorkspace,
    publishStatus: (next) => {
      if (withdrawn) return;
      status = next;
      republish(true);
    },
    withdraw: () => {
      handler();
      const off = options.off ?? ((event, listener) => process.off(event, listener));
      off('exit', handler);
    },
  };
}
