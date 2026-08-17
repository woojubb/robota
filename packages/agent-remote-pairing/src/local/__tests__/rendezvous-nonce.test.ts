import { describe, expect, it } from 'vitest';

import { DEFAULT_GRANT_TTL_MS, RendezvousGrantLedger } from '../rendezvous-nonce.js';

const NOW = 1_700_000_000_000;
const GUARDED = '/run/user/1000/robota/peers';
const OTHER = '/run/user/1000/robota/other';

describe('SEC-010 — the nonce carries the kernel’s answer from the rendezvous to the channel', () => {
  it('honours a grant presented at the rendezvous it was issued for', () => {
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW });

    const result = ledger.redeem(grant.nonce, GUARDED, NOW + 1);

    expect(result.honoured).toBe(true);
    expect(result.grant?.rendezvous).toBe(GUARDED);
    expect(grant.expiresAt).toBe(NOW + DEFAULT_GRANT_TTL_MS);
  });

  it('TC-04: a second presentation is refused, and named as a replay', () => {
    // Single-use is the property that keeps the nonce from becoming what this whole item exists to
    // avoid — a copyable credential. `replayed` rather than `unknown` because an operator seeing a
    // value honoured twice is looking at a bug or an attack, not at a slow peer.
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW });

    expect(ledger.redeem(grant.nonce, GUARDED, NOW + 1).honoured).toBe(true);
    const second = ledger.redeem(grant.nonce, GUARDED, NOW + 2);

    expect(second.honoured).toBe(false);
    expect(second.rejection).toBe('replayed');
  });

  it('refuses a nonce nobody issued, without claiming it was replayed', () => {
    const ledger = new RendezvousGrantLedger();

    expect(ledger.redeem('never-issued', GUARDED, NOW).rejection).toBe('unknown');
  });

  it('TC-05: refuses once the window has closed', () => {
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW, ttlMs: 1_000 });

    expect(ledger.redeem(grant.nonce, GUARDED, NOW + 1_000).rejection).toBe('expired');
  });

  it('a refused presentation still spends the nonce', () => {
    // Otherwise single-use would hold only for peers that got everything right first time: a holder
    // could probe with a wrong rendezvous, learn nothing, and keep the value for a real attempt.
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW });

    expect(ledger.redeem(grant.nonce, OTHER, NOW + 1).rejection).toBe('wrong-rendezvous');
    expect(ledger.redeem(grant.nonce, GUARDED, NOW + 2).rejection).toBe('replayed');
  });

  it('a grant is not portable between rendezvous', () => {
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW });

    expect(ledger.redeem(grant.nonce, OTHER, NOW + 1).honoured).toBe(false);
  });
});

describe('SEC-010 — concurrency, revocation and cleanup are asserted, not assumed', () => {
  it('TC-06: two peers presenting the same nonce cannot both be admitted', () => {
    // An admission race resolved by timing is an admission decision nobody made. Exactly one wins,
    // and the loser is refused rather than queued.
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW });

    const attempts = [
      ledger.redeem(grant.nonce, GUARDED, NOW + 1),
      ledger.redeem(grant.nonce, GUARDED, NOW + 1),
    ];

    expect(attempts.filter((a) => a.honoured)).toHaveLength(1);
    expect(attempts.find((a) => !a.honoured)?.rejection).toBe('replayed');
  });

  it('TC-07: revoking a rendezvous ends admissibility for its outstanding grants', () => {
    // SEC-010: the entry IS the grant. Once the owning session is gone, nothing it handed out may
    // still open a channel.
    const ledger = new RendezvousGrantLedger();
    const mine = ledger.issue({ rendezvous: GUARDED, now: NOW });
    const elsewhere = ledger.issue({ rendezvous: OTHER, now: NOW });

    expect(ledger.revokeRendezvous(GUARDED)).toBe(1);

    expect(ledger.redeem(mine.nonce, GUARDED, NOW + 1).rejection).toBe('unknown');
    expect(ledger.redeem(elsewhere.nonce, OTHER, NOW + 1).honoured).toBe(true);
  });

  it('revoking a rendezvous with nothing outstanding reports zero rather than pretending', () => {
    expect(new RendezvousGrantLedger().revokeRendezvous(GUARDED)).toBe(0);
  });

  it('expiry sweeps the live grants and reports what it dropped', () => {
    const ledger = new RendezvousGrantLedger();
    ledger.issue({ rendezvous: GUARDED, now: NOW, ttlMs: 1_000 });
    ledger.issue({ rendezvous: GUARDED, now: NOW, ttlMs: 10_000 });

    expect(ledger.expire(NOW + 1_000)).toBe(1);
    expect(ledger.outstanding).toBe(1);
  });

  it('the spent set does not grow without bound', () => {
    // A ledger that leaks is a ledger that gets disabled. After a nonce ages out, the ledger
    // genuinely no longer knows it — `unknown` is then the honest answer, not a downgrade.
    const ledger = new RendezvousGrantLedger();
    const grant = ledger.issue({ rendezvous: GUARDED, now: NOW, ttlMs: 1_000 });
    ledger.redeem(grant.nonce, GUARDED, NOW + 1);

    expect(ledger.redeem(grant.nonce, GUARDED, NOW + 2).rejection).toBe('replayed');
    ledger.expire(NOW + 1_000);
    expect(ledger.redeem(grant.nonce, GUARDED, NOW + 1_001).rejection).toBe('unknown');
  });

  it('a colliding generator never overwrites a live grant', () => {
    // Not going to happen with 32 random bytes; cheap to make impossible rather than improbable,
    // and the failure it would cause is refusing a peer that did nothing wrong.
    const ledger = new RendezvousGrantLedger();
    const values = ['same', 'same', 'different'];
    let i = 0;
    const generate = () => values[i++] ?? 'exhausted';

    const first = ledger.issue({ rendezvous: GUARDED, now: NOW, generate });
    const second = ledger.issue({ rendezvous: GUARDED, now: NOW, generate });

    expect(first.nonce).toBe('same');
    expect(second.nonce).toBe('different');
    expect(ledger.outstanding).toBe(2);
  });

  it('issues values that differ without an injected generator', () => {
    const ledger = new RendezvousGrantLedger();

    const nonces = new Set(
      Array.from({ length: 50 }, () => ledger.issue({ rendezvous: GUARDED, now: NOW }).nonce),
    );

    expect(nonces.size).toBe(50);
  });
});
