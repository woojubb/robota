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
  type IRegistryOptions,
} from './local-peer-registry.js';
import { ensureRendezvousDirectory } from './local-peer-rendezvous.js';

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

export interface ILocalPeerPresence {
  readonly sessionId: string;
  /** Every announced session, this one included. */
  list(): readonly TPeerSummary[];
  /** Remove this session's entry and stop listening for the exit. Idempotent. */
  withdraw(): void;
}

export interface IPresenceOptions {
  readonly sessionId: string;
  readonly name?: string;
  /** Injected so a case can drive the exit path without ending the test runner. */
  readonly on?: (event: 'exit', handler: () => void) => void;
  readonly off?: (event: 'exit', handler: () => void) => void;
  readonly registry?: Pick<IRegistryOptions, 'readStartTime' | 'now'>;
  /** Injected so a case can point at a scratch directory instead of the real rendezvous. */
  readonly guardedDirectory?: string;
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

  announcePeer(registry, {
    sessionId: options.sessionId,
    ...(options.name !== undefined ? { name: options.name } : {}),
  });

  let withdrawn = false;
  const handler = (): void => {
    if (withdrawn) return;
    withdrawn = true;
    withdrawPeer(registry, options.sessionId);
  };
  const on = options.on ?? ((event, listener) => process.on(event, listener));
  on('exit', handler);

  return {
    sessionId: options.sessionId,
    list: () =>
      listPeers(registry).map((discovered) => ({
        sessionId: discovered.entry.sessionId,
        ...(discovered.entry.name !== undefined ? { name: discovered.entry.name } : {}),
        liveness: discovered.liveness,
      })),
    withdraw: () => {
      handler();
      const off = options.off ?? ((event, listener) => process.off(event, listener));
      off('exit', handler);
    },
  };
}
