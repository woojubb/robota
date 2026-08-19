import { describe, expect, it } from 'vitest';

import { openLocalPeerRendezvous, revokeRendezvousOnExit } from '../local-peer-admission.js';

/**
 * SEC-010 composition (#1862) — the live rendezvous the WebRTC gate consumes.
 *
 * The gate implements no cryptographic policy; it asks this. So what is asserted here is that the
 * answer it gets is the one the ledger justifies, and that it degrades to a refusal rather than to
 * a weaker admission.
 */
const GUARDED = '/run/user/1000/robota/peers';

function rendezvous(now = () => 1_000) {
  return openLocalPeerRendezvous({ guardedDirectory: GUARDED, now });
}

describe('#1862 — issuing and redeeming a rendezvous grant', () => {
  it('a freshly issued nonce is admitted as same-user-same-host', () => {
    const rv = rendezvous();

    const admission = rv.redeem(rv.issueGrant('session_a').nonce);

    expect(admission.admitted).toBe(true);
    expect(admission.trust).toBe('same-user-same-host');
  });

  it('never produces token-only, because possession is what SEC-010 rejected', () => {
    // The two trust vocabularies overlap and are not the same. A local rendezvous cannot justify
    // `token-only`, and this pins that rather than trusting the translation to stay written out.
    const rv = rendezvous();

    expect(rv.redeem(rv.issueGrant('session_a').nonce).trust).not.toBe('token-only');
  });

  it('a second presentation is refused, and the refusal names the reason', () => {
    const rv = rendezvous();
    const grant = rv.issueGrant('session_a');
    rv.redeem(grant.nonce);

    const second = rv.redeem(grant.nonce);

    expect(second.admitted).toBe(false);
    expect(second.trust).toBe('unproven');
    expect(second.reason).toContain('replayed');
  });

  it('a nonce nobody issued is refused, and is distinguishable from a replay', () => {
    expect(rendezvous().redeem('never-issued').reason).toContain('unknown');
  });

  it('an expired grant is refused', () => {
    let clock = 1_000;
    const rv = openLocalPeerRendezvous({
      guardedDirectory: GUARDED,
      now: () => clock,
      ttlMs: 100,
    });
    const grant = rv.issueGrant('session_a');

    clock = 1_101;

    expect(rv.redeem(grant.nonce).reason).toContain('expired');
  });
});

describe('#1862 — revocation is the session exiting', () => {
  it('revokeAll reports how many were live, so a caller can log rather than assume', () => {
    const rv = rendezvous();
    rv.issueGrant('session_a');
    rv.issueGrant('session_b');

    expect(rv.revokeAll()).toBe(2);
  });

  it('a revoked grant cannot open a channel afterwards', () => {
    // SEC-010: the entry IS the grant. Once the owning session is gone, nothing it handed out may
    // still be admitted.
    const rv = rendezvous();
    const grant = rv.issueGrant('session_a');
    rv.revokeAll();

    expect(rv.redeem(grant.nonce).admitted).toBe(false);
  });

  it('revoking twice reports zero rather than pretending', () => {
    const rv = rendezvous();
    rv.issueGrant('session_a');
    rv.revokeAll();

    expect(rv.revokeAll()).toBe(0);
  });
});

describe('#1862 — a rendezvous does not outlive its session', () => {
  it('revokes on process exit', () => {
    // SEC-010: the entry IS the grant. Relying on the TTL instead would leave a window equal to
    // that TTL after exit — small, but the mechanism's point is that the session ending closes it,
    // not a clock.
    const rv = rendezvous();
    const grant = rv.issueGrant('session_a');
    let fire: (() => void) | undefined;

    revokeRendezvousOnExit(rv, (_event, handler) => {
      fire = handler;
    });
    fire?.();

    expect(rv.redeem(grant.nonce).admitted).toBe(false);
  });

  it('detaching stops the revocation, so a torn-down session is not the only way out', () => {
    const rv = rendezvous();
    const grant = rv.issueGrant('session_a');
    const handlers: Array<() => void> = [];

    const detach = revokeRendezvousOnExit(
      rv,
      (_event, handler) => handlers.push(handler),
      (_event, handler) => {
        const at = handlers.indexOf(handler);
        if (at >= 0) handlers.splice(at, 1);
      },
    );
    detach();
    for (const handler of handlers) handler();

    expect(rv.redeem(grant.nonce).admitted).toBe(true);
  });
});
