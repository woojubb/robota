import { describe, expect, it } from 'vitest';

import {
  issueRootRotation,
  previousRootStillAccepted,
  verifyRootRotation,
} from '../root-rotation.js';
import {
  deriveUserId,
  generateUserRootKeyPair,
  issueDeviceCertificate,
  verifyDeviceCertificate,
} from '../user-identity.js';
import { exportPublicKey, generateIdentityKeyPair } from '../device-identity.js';

/**
 * SEC-011 (issue #1865) — rotating the user root, and the case this mechanism deliberately does NOT
 * handle.
 *
 * The lock-out case is the one worth reading first: without the successor's countersignature, a
 * statement naming a public key nobody holds verifies perfectly and moves every verifier to an
 * identity that can never issue a certificate again.
 */

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

async function root() {
  const pair = await generateUserRootKeyPair(true);
  return { pair, userId: await deriveUserId(pair.publicKey) };
}

async function rotation(overrides: Partial<Parameters<typeof issueRootRotation>[0]> = {}) {
  const previous = await root();
  const next = await root();
  const value = await issueRootRotation({
    previousUserId: previous.userId,
    nextUserId: next.userId,
    previousRootPrivateKey: previous.pair.privateKey,
    nextRootKeyPair: next.pair,
    rotatedAt: NOW,
    previousValidUntil: NOW + 7 * DAY,
    ...overrides,
  });
  return { rotation: value, previous, next };
}

describe('a rotation both roots signed', () => {
  it('is accepted, and names the successor a verifier should start trusting', async () => {
    const { rotation: r, previous, next } = await rotation();
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW + 1,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.nextUserId).toBe(next.userId);
    expect(verdict.nextRootPublicKey).toBe(await exportPublicKey(next.pair.publicKey));
  });

  it('bounds how long the retiring root stays acceptable', async () => {
    const { rotation: r, previous } = await rotation();
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW + 1,
    });
    expect(previousRootStillAccepted(verdict, NOW + DAY)).toBe(true);
    expect(previousRootStillAccepted(verdict, NOW + 7 * DAY)).toBe(false);
  });

  it('says no for a verdict that was never accepted, rather than reading a bound off it', async () => {
    // The tempting spelling at a call site reads `previousValidUntil` off the raw statement. Taking
    // the VERDICT means the only way to ask is to have verified first.
    expect(previousRootStillAccepted({ accepted: false }, NOW)).toBe(false);
  });
});

describe('the successor must countersign, or the user is locked out', () => {
  it('refuses a statement the named successor did not sign', async () => {
    // The attack: anyone holding the old key names a public key they do NOT hold. Everything the
    // retiring root signed is genuine, and every verifier would move to an identity nobody can
    // issue certificates for.
    const { rotation: r, previous } = await rotation();
    const impostor = await root();
    const forged = { ...r, nextRootPublicKey: await exportPublicKey(impostor.pair.publicKey) };

    const verdict = await verifyRootRotation(forged, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW + 1,
    });
    // Editing the named key breaks what the PREVIOUS root signed first — which is the point: the
    // successor's key is inside the retiring root's signature, so it cannot be swapped afterwards.
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('previous-signature-invalid');
  });

  it('refuses when the countersignature alone is wrong', async () => {
    const { rotation: r, previous } = await rotation();
    const other = await rotation();
    const verdict = await verifyRootRotation(
      { ...r, nextSignature: other.rotation.nextSignature },
      {
        previousRootPublicKey: previous.pair.publicKey,
        expectedPreviousUserId: previous.userId,
        now: NOW + 1,
      },
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('next-signature-invalid');
  });
});

describe('every claim is inside both signatures', () => {
  it.each([
    ['previousValidUntil', { previousValidUntil: NOW + 3650 * DAY }],
    ['rotatedAt', { rotatedAt: NOW - DAY }],
    ['nextUserId', { nextUserId: 'someone-else' }],
  ])('editing %s invalidates it', async (_field, edit) => {
    const { rotation: r, previous } = await rotation();
    const verdict = await verifyRootRotation(
      { ...r, ...edit },
      {
        previousRootPublicKey: previous.pair.publicKey,
        expectedPreviousUserId: previous.userId,
        now: NOW + 1,
      },
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('previous-signature-invalid');
  });
});

describe('what a verifier refuses on its own terms', () => {
  it('refuses a rotation away from a root it does not hold', async () => {
    // A genuine rotation for someone else's identity is not this machine's business, and applying
    // it would move a verifier onto an unrelated user's root.
    const { rotation: r, previous } = await rotation();
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: 'a-different-user',
      now: NOW + 1,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('wrong-previous-root');
  });

  it('refuses one dated in the future', async () => {
    const { rotation: r, previous } = await rotation();
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW - 1,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('not-yet-valid');
  });

  it('refuses an overlap that ends before it begins', async () => {
    // Malformed, not "no overlap". Reading it as zero overlap would silently invalidate every
    // enrolled device at a moment the signer may not have intended.
    const { rotation: r, previous } = await rotation({ previousValidUntil: NOW - DAY });
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW + 1,
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.rejection).toBe('overlap-inverted');
  });

  it('accepts a zero-length overlap, which is a tight window rather than a malformed one', async () => {
    // The boundary the case above is about. Without this, "inverted" and "immediate" would be one
    // rejection and a user who wanted no grace period could not express it.
    const { rotation: r, previous } = await rotation({ previousValidUntil: NOW });
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW + 1,
    });
    expect(verdict.accepted).toBe(true);
    expect(previousRootStillAccepted(verdict, NOW + 1)).toBe(false);
  });
});

describe('a device caught mid-rotation (TC-08)', () => {
  it('keeps working inside the overlap and stops at its end, with the same certificate', async () => {
    // The certificate never changes. What changes is whether the root that signed it is still
    // acceptable — which is the whole point of a bounded overlap: enrolled devices keep working
    // while they are re-certified, and there is a deadline for doing it.
    const previous = await root();
    const next = await root();
    const device = await generateIdentityKeyPair(true);
    const certificate = await issueDeviceCertificate({
      rootPrivateKey: previous.pair.privateKey,
      userId: previous.userId,
      devicePublicKey: device.publicKey,
      issuedAt: NOW,
      expiresAt: NOW + 30 * DAY,
    });

    const r = await issueRootRotation({
      previousUserId: previous.userId,
      nextUserId: next.userId,
      previousRootPrivateKey: previous.pair.privateKey,
      nextRootKeyPair: next.pair,
      rotatedAt: NOW,
      previousValidUntil: NOW + 7 * DAY,
    });
    const verdict = await verifyRootRotation(r, {
      previousRootPublicKey: previous.pair.publicKey,
      expectedPreviousUserId: previous.userId,
      now: NOW + 1,
    });
    expect(verdict.accepted).toBe(true);

    // Inside the window the certificate still verifies against the retiring root.
    expect(previousRootStillAccepted(verdict, NOW + DAY)).toBe(true);
    const inside = await verifyDeviceCertificate(certificate, {
      rootPublicKey: previous.pair.publicKey,
      expectedUserId: previous.userId,
      now: NOW + DAY,
    });
    expect(inside.valid).toBe(true);

    // Past it, the certificate is unchanged and still cryptographically intact — and the rotation is
    // what refuses it. Asserting the certificate alone would miss that: it does not expire until day
    // 30, so nothing about the certificate says the device should stop.
    expect(previousRootStillAccepted(verdict, NOW + 8 * DAY)).toBe(false);
    const stillIntact = await verifyDeviceCertificate(certificate, {
      rootPublicKey: previous.pair.publicKey,
      expectedUserId: previous.userId,
      now: NOW + 8 * DAY,
    });
    expect(stillIntact.valid).toBe(true);
  });

  it('a certificate re-issued by the SUCCESSOR is a different user id, and that is the migration', async () => {
    // The successor has its own `userId` — derived from its own key — so a verifier that moved on
    // expects certificates naming it. A re-certified device is not the old certificate patched; it
    // is a new one, and the id is what makes the two impossible to confuse.
    const previous = await root();
    const next = await root();
    const device = await generateIdentityKeyPair(true);
    const reissued = await issueDeviceCertificate({
      rootPrivateKey: next.pair.privateKey,
      userId: next.userId,
      devicePublicKey: device.publicKey,
      issuedAt: NOW,
      expiresAt: NOW + 30 * DAY,
    });

    expect(next.userId).not.toBe(previous.userId);
    const underNext = await verifyDeviceCertificate(reissued, {
      rootPublicKey: next.pair.publicKey,
      expectedUserId: next.userId,
      now: NOW + 1,
    });
    expect(underNext.valid).toBe(true);

    // And a verifier still expecting the OLD user refuses it, rather than accepting a certificate
    // for an identity it has not been told to trust.
    const underPrevious = await verifyDeviceCertificate(reissued, {
      rootPublicKey: next.pair.publicKey,
      expectedUserId: previous.userId,
      now: NOW + 1,
    });
    expect(underPrevious.valid).toBe(false);
    expect(underPrevious.rejection).toBe('user-mismatch');
  });
});
