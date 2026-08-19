/**
 * SEC-010 composition (#1862): the live rendezvous — issuing grants and answering redemptions.
 *
 * `local-peer-rendezvous.ts` decides WHERE the guarded directory is and proves it. This holds the
 * ledger for that directory and produces the port the WebRTC gate consumes, which is the last hop
 * between "the kernel vouched for this peer" and "this channel may carry a session".
 *
 * ## Why this is the composition root's job and not the transport's
 *
 * #1810 is explicit that WebRTC must implement no cryptographic policy: the gate holds a state
 * machine and asks an injected `redeem`. Someone has to own the ledger, know which rendezvous it
 * belongs to, and revoke it on the way out — and that someone is whoever knows this process's
 * lifecycle. That is here.
 *
 * ## The trust translation, and why it is not a cast
 *
 * The ledger speaks `TLocalPeerTrust` (`same-user-same-host` | `unproven`); the gate consumes
 * `IPeerAdmission` with `TPeerTrust` (which also has `token-only`). They overlap but are not the
 * same vocabulary, and the missing member is the point: a local rendezvous can never produce
 * `token-only`, because possession of a token is exactly the evidence SEC-010 rejected. So the
 * translation is written out rather than widened — a structural cast would compile today and
 * silently start emitting a trust level this path cannot justify the day either union changes.
 */

import {
  DEFAULT_GRANT_TTL_MS,
  RendezvousGrantLedger,
  type IRendezvousGrant,
} from '@robota-sdk/agent-remote-pairing/local';

import type { IPeerAdmission } from '@robota-sdk/agent-interface-transport';

/** What a composition root needs from a live rendezvous. */
export interface ILocalPeerRendezvous {
  /** Issue a grant for a peer that has reached the guarded directory. */
  readonly issueGrant: (sessionId: string) => IRendezvousGrant;
  /** The port the WebRTC gate consumes: redeem a presented nonce, get an admission. */
  readonly redeem: (nonce: string) => IPeerAdmission;
  /** End admissibility for everything this rendezvous handed out. Returns how many were live. */
  readonly revokeAll: () => number;
}

export interface IOpenRendezvousOptions {
  /** The verified guarded directory (`ILocalPeerAdmission.binding.guardedDirectory`). */
  readonly guardedDirectory: string;
  /** Clock, injected so grant windows are testable without waiting. */
  readonly now?: () => number;
  /** Grant lifetime; defaults to the ledger's own. */
  readonly ttlMs?: number;
}

/**
 * A refusal shaped like every other admission, so the gate never has to special-case this path.
 *
 * The rejection reason is carried through verbatim rather than flattened to "refused": `replayed`
 * and `unknown` are different operational facts, and an operator who cannot tell them apart cannot
 * act on either.
 */
function refuse(reason: string): IPeerAdmission {
  return { admitted: false, trust: 'unproven', reason };
}

/**
 * Open the rendezvous for a verified guarded directory.
 *
 * The directory must ALREADY be verified — this takes the path out of an admission rather than a
 * bare string from a caller, because a ledger keyed on an unverified directory would issue grants
 * that assert a guarantee nobody established.
 */
export function openLocalPeerRendezvous(options: IOpenRendezvousOptions): ILocalPeerRendezvous {
  const ledger = new RendezvousGrantLedger();
  const now = options.now ?? Date.now;
  const rendezvous = options.guardedDirectory;

  return {
    issueGrant: (_sessionId: string): IRendezvousGrant =>
      ledger.issue({
        rendezvous,
        now: now(),
        ttlMs: options.ttlMs ?? DEFAULT_GRANT_TTL_MS,
      }),

    redeem: (nonce: string): IPeerAdmission => {
      const result = ledger.redeem(nonce, rendezvous, now());
      if (!result.honoured || result.grant === undefined) {
        return refuse(
          `the rendezvous nonce was not honoured (${result.rejection ?? 'unknown'}). ` +
            'Reaching the guarded directory is what this proves; a nonce that cannot be redeemed ' +
            'proves nothing about where the peer runs.',
        );
      }
      // Written out rather than spread from the ledger's result: the two trust vocabularies overlap
      // and are not the same, and `same-user-same-host` is the ONLY level this path can justify.
      return { admitted: true, trust: 'same-user-same-host' };
    },

    revokeAll: (): number => ledger.revokeRendezvous(rendezvous),
  };
}

/**
 * Bind a rendezvous to a process lifetime.
 *
 * SEC-010 says the entry IS the grant: once the owning session is gone, nothing it handed out may
 * still be admitted. Relying on the grant TTL instead would leave a window equal to that TTL after
 * exit — small, but the whole point of the mechanism is that the window is closed by the session
 * ending rather than by a clock.
 *
 * Returns the unsubscribe so a caller can detach without exiting: a test, and a session that is
 * torn down while the process lives on. Without it the only way to stop revoking would be to exit,
 * which is the thing being tested.
 */
export function revokeRendezvousOnExit(
  rendezvous: ILocalPeerRendezvous,
  on: (event: 'exit', handler: () => void) => void = (event, handler) => {
    process.on(event, handler);
  },
  off?: (event: 'exit', handler: () => void) => void,
): () => void {
  const handler = (): void => {
    rendezvous.revokeAll();
  };
  on('exit', handler);
  return () => {
    (off ?? ((event, h) => process.off(event, h)))('exit', handler);
  };
}
