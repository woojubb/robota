/**
 * SEC-010, second half: carrying the kernel's answer from the rendezvous to the channel.
 *
 * `peer-credential.ts` establishes the environment — a peer that reached a 0700 directory owned by
 * this user could only have come from this machine, as this user. But that fact is about the
 * RENDEZVOUS, and the session's messages travel over a different carrier. Without a binding between
 * the two, a peer could prove itself at the guarded socket and then hand the channel to somebody
 * else, and the admission would still read as `same-user-same-host`. The environment proof would be
 * true and useless.
 *
 * So the rendezvous issues a nonce, and the pairing confirmation on the channel has to present it
 * back. What the nonce carries is not secrecy — it is the STATEMENT "the party on this channel is
 * the party the kernel vouched for at that rendezvous, on this attempt".
 *
 * ## Why this is a grant ledger and not a random string
 *
 * The SEC-010 failure semantics are specific, and each one is a rule about the nonce's lifetime
 * rather than about its bytes:
 *
 * - **Single use.** A second presentation is a rejection, never a re-admission. A nonce that admits
 *   twice binds nothing on the second attempt — it has become a copyable credential, which is the
 *   exact failure the whole item exists to avoid.
 * - **Bounded window.** Admission expires. An indefinitely valid nonce left in a log or a crashed
 *   process's memory is a standing invitation.
 * - **Revocation is the entry's existence.** The rendezvous grant IS the entry; removing it (session
 *   exit, explicit revoke) ends admissibility for new attempts immediately.
 * - **Concurrency is deterministic.** Two peers presenting the same nonce cannot both win, and the
 *   loser must be refused rather than queued — an admission race resolved by timing is an admission
 *   decision nobody made.
 *
 * ## What this deliberately does not do
 *
 * It does not generate the nonce's randomness policy or hash it — `crypto.getRandomValues` is the
 * source and the value is compared whole. It does not touch the filesystem: the guarded directory is
 * `peer-credential.ts`'s subject, and a module that both judged the directory and held the ledger
 * would make the two failure modes hard to tell apart in a test.
 *
 * Time is injected. A ledger whose expiry is read from the ambient clock cannot be tested for the
 * window it claims to enforce, and "it expires eventually" is not the property SEC-010 asks for.
 */

/** Why a presented nonce was not honoured. A closed vocabulary — the caller acts on which one. */
export type TNonceRejection =
  /** No grant with this value: never issued, already consumed, or revoked. */
  | 'unknown'
  /** Issued, but its window has closed. */
  | 'expired'
  /** Presented a second time. The first presentation consumed it. */
  | 'replayed'
  /** Presented against a different rendezvous than the one it was issued for. */
  | 'wrong-rendezvous';

export interface IRendezvousGrant {
  /** The value the peer must present back on the channel. */
  readonly nonce: string;
  /** The guarded directory this grant was issued at — a nonce is not portable between rendezvous. */
  readonly rendezvous: string;
  /** When admission stops being possible, in epoch milliseconds. */
  readonly expiresAt: number;
}

export interface IRendezvousRedemption {
  readonly honoured: boolean;
  /** Present when honoured — what the grant established, for the channel gate to carry forward. */
  readonly grant?: IRendezvousGrant;
  /** Present when refused. */
  readonly rejection?: TNonceRejection;
}

export interface IIssueOptions {
  /** The guarded rendezvous this grant belongs to (`ILocalPeerBinding.guardedDirectory`). */
  readonly rendezvous: string;
  /** Now, in epoch milliseconds. Injected so the window is testable. */
  readonly now: number;
  /** How long the grant stays admissible. */
  readonly ttlMs?: number;
  /** Nonce source, injected only so a test can make a collision reproducible. */
  readonly generate?: () => string;
}

/**
 * How long a rendezvous grant stays admissible.
 *
 * Thirty seconds is a connection setup, not a session: the peer has already reached the guarded
 * socket when the grant is issued, so the only thing that has to fit in the window is the channel
 * handshake. A longer default would buy nothing and widen the interval in which a leaked value is
 * still worth something.
 */
export const DEFAULT_GRANT_TTL_MS = 30_000;

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The set of grants a rendezvous will still honour.
 *
 * A live object rather than a pure function because single-use and revocation are STATE — the second
 * presentation of a nonce differs from the first only in what happened in between, and nothing
 * stateless can tell them apart.
 */
export class RendezvousGrantLedger {
  private readonly grants = new Map<string, IRendezvousGrant>();
  /**
   * Nonces already spent, held until their original window closes.
   *
   * Kept so a second presentation reports `replayed` rather than `unknown`. That distinction is
   * worth the memory: `unknown` is consistent with a peer that was slow or a grant that was revoked,
   * while `replayed` means a value that was honoured once is being presented again — a bug or an
   * attack, and an operator who cannot tell those apart cannot act on either.
   *
   * There is no information-leak argument against it HERE, which is why this differs from a public
   * endpoint: the only party that can reach this rendezvous already passed the kernel's check as
   * this user, and could read the process's memory outright.
   *
   * Bounded by `expire()`, which sweeps this alongside the live grants. Without that it would be a
   * set that only ever grows — a ledger that leaks is a ledger that gets disabled.
   */
  private readonly spent = new Map<string, number>();

  /** Issue a grant for a peer the kernel has already vouched for at `rendezvous`. */
  issue(options: IIssueOptions): IRendezvousGrant {
    const generate = options.generate ?? randomNonce;
    let nonce = generate();
    // A collision would silently overwrite a live grant, refusing a peer that did nothing wrong. It
    // is not going to happen with 32 random bytes; it is cheap to make impossible rather than
    // improbable, and a test can force the case by injecting a generator that repeats.
    while (this.grants.has(nonce)) nonce = generate();

    const grant: IRendezvousGrant = {
      nonce,
      rendezvous: options.rendezvous,
      expiresAt: options.now + (options.ttlMs ?? DEFAULT_GRANT_TTL_MS),
    };
    this.grants.set(nonce, grant);
    return grant;
  }

  /**
   * Present a nonce on the channel. Honoured at most once, ever.
   *
   * The grant is removed BEFORE the expiry check rather than after: an expired grant is finished
   * either way, and leaving it in the map would let a caller that retries on `expired` keep a dead
   * entry alive in memory for as long as it cared to.
   */
  redeem(nonce: string, rendezvous: string, now: number): IRendezvousRedemption {
    const grant = this.grants.get(nonce);
    if (grant === undefined) {
      // A value we have already honoured is a different fact from one we have never seen, and the
      // refusal says which. Revoked and never-issued DO share `unknown` — the caller's next step is
      // the same for both, and neither indicates anything went wrong.
      return { honoured: false, rejection: this.spent.has(nonce) ? 'replayed' : 'unknown' };
    }
    // Spent the moment it is presented, before any other check. Every path below this line is a
    // refusal, and a nonce that could be presented again after a failed check would be single-use
    // only for peers that got everything right the first time.
    this.grants.delete(nonce);
    this.spent.set(nonce, grant.expiresAt);

    if (grant.rendezvous !== rendezvous) {
      // A nonce presented at the wrong rendezvous has travelled somewhere it was not meant to go.
      // Consuming it is the point: the holder does not get to try again at the right one.
      return { honoured: false, rejection: 'wrong-rendezvous' };
    }
    if (now >= grant.expiresAt) return { honoured: false, rejection: 'expired' };

    return { honoured: true, grant };
  }

  /**
   * Revoke every grant for a rendezvous — the owning session exited, or revoked explicitly.
   *
   * Returns how many were live, so a caller can report rather than assume. SEC-010 says the entry IS
   * the grant: once this runs, no new attempt at that rendezvous can be admitted.
   */
  revokeRendezvous(rendezvous: string): number {
    let revoked = 0;
    for (const [nonce, grant] of this.grants) {
      if (grant.rendezvous !== rendezvous) continue;
      this.grants.delete(nonce);
      revoked += 1;
    }
    return revoked;
  }

  /**
   * Drop grants whose window has closed, and forget spent nonces past theirs. Returns how many live
   * grants were dropped — the spent-side sweep is bookkeeping, not an event a caller reports.
   *
   * Both sides are swept here because both grow: the live map with grants nobody redeemed, and the
   * spent map with every nonce ever honoured. A replay arriving after its nonce ages out reads as
   * `unknown` rather than `replayed`, which is the honest answer — by then the ledger genuinely does
   * not know.
   */
  expire(now: number): number {
    let dropped = 0;
    for (const [nonce, grant] of this.grants) {
      if (now < grant.expiresAt) continue;
      this.grants.delete(nonce);
      dropped += 1;
    }
    for (const [nonce, expiresAt] of this.spent) {
      if (now < expiresAt) continue;
      this.spent.delete(nonce);
    }
    return dropped;
  }

  /** How many grants are still admissible, for a caller asserting cleanup rather than trusting it. */
  get outstanding(): number {
    return this.grants.size;
  }
}
