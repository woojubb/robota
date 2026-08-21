import { describe, expect, it } from 'vitest';

import {
  deriveUserId,
  generateUserRootKeyPair,
  issueDeviceCertificate,
  verifyDeviceCertificate,
} from '../user-identity.js';
import {
  issueRevocationList,
  revocationUnavailable,
  verifyRevocationList,
  type IRevocationList,
} from '../revocation-list.js';
import { generateIdentityKeyPair } from '../device-identity.js';

/**
 * SEC-011 (issue #1865) — how a revocation reaches the machine doing the checking.
 *
 * A revocation is the one security statement whose ABSENCE is the attack: a certificate that never
 * arrives simply fails to authenticate, while a revocation that never arrives silently authorizes a
 * device the user retired. So every case here is about what happens when the list is missing, old,
 * rolled back, or edited — not about the happy path, which is one line.
 */

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

async function user() {
  const root = await generateUserRootKeyPair(true);
  return { root, userId: await deriveUserId(root.publicKey) };
}

async function list(
  overrides: Partial<Parameters<typeof issueRevocationList>[0]> = {},
  signer?: CryptoKey,
  userId?: string,
): Promise<{ list: IRevocationList; root: CryptoKeyPair; userId: string }> {
  const u = await user();
  const claims = {
    userId: userId ?? u.userId,
    revokedDeviceIds: [] as readonly string[],
    issuedAt: NOW,
    expiresAt: NOW + HOUR,
    ...overrides,
  };
  return {
    list: await issueRevocationList(claims, signer ?? u.root.privateKey),
    root: u.root,
    userId: u.userId,
  };
}

describe('a usable list', () => {
  it('verifies and hands back exactly the ids it was signed over', async () => {
    const { list: l, root, userId } = await list({ revokedDeviceIds: ['dev-a', 'dev-b'] });
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: root.publicKey,
      expectedUserId: userId,
      now: NOW + 1,
    });
    expect(verdict.usable).toBe(true);
    expect(verdict.revokedDeviceIds).toEqual(['dev-a', 'dev-b']);
  });

  it('an EMPTY list is a statement, not an absence', async () => {
    // "Nothing is revoked as of now" is exactly why a list is issued on a schedule rather than only
    // when something is revoked — a user who has revoked nothing still needs a fresh one, or every
    // verifier goes permanently stale.
    const { list: l, root, userId } = await list({ revokedDeviceIds: [] });
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: root.publicKey,
      expectedUserId: userId,
      now: NOW + 1,
    });
    expect(verdict.usable).toBe(true);
    expect(verdict.revokedDeviceIds).toEqual([]);
  });

  it('signs the same statement to the same bytes whatever order it was assembled in', async () => {
    // Without the sort, a re-issue with a reordered array is a different signature over an identical
    // statement — and two verifiers comparing bytes would call them different lists.
    const u = await user();
    const a = await issueRevocationList(
      { userId: u.userId, revokedDeviceIds: ['b', 'a'], issuedAt: NOW, expiresAt: NOW + HOUR },
      u.root.privateKey,
    );
    const b = await issueRevocationList(
      { userId: u.userId, revokedDeviceIds: ['a', 'b'], issuedAt: NOW, expiresAt: NOW + HOUR },
      u.root.privateKey,
    );
    // ECDSA is randomised, so the SIGNATURES differ. What must match is that each verifies against
    // the other's claim ordering — which is what proves the signed bytes are the same.
    const verdict = await verifyRevocationList(
      { ...b, revokedDeviceIds: ['b', 'a'] },
      { rootPublicKey: u.root.publicKey, expectedUserId: u.userId, now: NOW + 1 },
    );
    expect(verdict.usable).toBe(true);
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('every claim is inside the signature', () => {
  it.each([
    ['revokedDeviceIds', { revokedDeviceIds: [] as readonly string[] }],
    ['issuedAt', { issuedAt: NOW - HOUR }],
    ['expiresAt', { expiresAt: NOW + 100 * HOUR }],
  ])('editing %s invalidates it', async (_field, edit) => {
    // The whole point: an attacker who can reach the list must not be able to REMOVE an entry, push
    // the expiry out, or roll the issue time back while the signature still verifies.
    const { list: l, root, userId } = await list({ revokedDeviceIds: ['dev-a'] });
    const verdict = await verifyRevocationList(
      { ...l, ...edit },
      { rootPublicKey: root.publicKey, expectedUserId: userId, now: NOW + 1 },
    );
    expect(verdict.usable).toBe(false);
    expect(verdict.rejection).toBe('signature-invalid');
  });

  it("a list signed by another root is not this user's", async () => {
    const other = await user();
    const mine = await user();
    const l = await issueRevocationList(
      { userId: mine.userId, revokedDeviceIds: ['dev-a'], issuedAt: NOW, expiresAt: NOW + HOUR },
      other.root.privateKey,
    );
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: mine.root.publicKey,
      expectedUserId: mine.userId,
      now: NOW + 1,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.rejection).toBe('signature-invalid');
  });

  it('a genuine list for a DIFFERENT user is refused, not silently applied', async () => {
    const other = await user();
    const l = await issueRevocationList(
      { userId: other.userId, revokedDeviceIds: ['dev-a'], issuedAt: NOW, expiresAt: NOW + HOUR },
      other.root.privateKey,
    );
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: other.root.publicKey,
      expectedUserId: 'someone-else',
      now: NOW + 1,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.rejection).toBe('user-mismatch');
  });
});

describe('freshness, which is what makes withholding fail closed', () => {
  it('refuses an expired list rather than reading it as "no revocations"', async () => {
    const { list: l, root, userId } = await list({ revokedDeviceIds: ['dev-a'] });
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: root.publicKey,
      expectedUserId: userId,
      now: NOW + HOUR,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.rejection).toBe('stale');
    // Nothing usable comes back. A caller cannot accidentally read an empty array off a refusal.
    expect(verdict.revokedDeviceIds).toBeUndefined();
  });

  it('accepts it one millisecond before it expires, so the bound is the bound', async () => {
    const { list: l, root, userId } = await list();
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: root.publicKey,
      expectedUserId: userId,
      now: NOW + HOUR - 1,
    });
    expect(verdict.usable).toBe(true);
  });

  it('refuses a genuine OLDER list once a newer one has been accepted', async () => {
    // The rollback. Both lists are signed and unexpired; the older one simply predates the
    // revocation the attacker cares about, and replaying it is the whole attack.
    const u = await user();
    const older = await issueRevocationList(
      { userId: u.userId, revokedDeviceIds: [], issuedAt: NOW, expiresAt: NOW + HOUR },
      u.root.privateKey,
    );
    const verdict = await verifyRevocationList(older, {
      rootPublicKey: u.root.publicKey,
      expectedUserId: u.userId,
      now: NOW + 1,
      newestAcceptedAt: NOW + 60_000,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.rejection).toBe('superseded');
  });

  it('accepts a list issued at exactly the high-water mark — a re-delivery is not a rollback', async () => {
    const { list: l, root, userId } = await list();
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: root.publicKey,
      expectedUserId: userId,
      now: NOW + 1,
      newestAcceptedAt: NOW,
    });
    expect(verdict.usable).toBe(true);
  });

  it('accepts the first list on a machine with no high-water mark', async () => {
    const { list: l, root, userId } = await list();
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: root.publicKey,
      expectedUserId: userId,
      now: NOW + 1,
    });
    expect(verdict.usable).toBe(true);
  });
});

describe('the list actually retires a device', () => {
  it('a revoked id fails certificate verification with an intact signature', async () => {
    // The join: this module produces the ids, `verifyDeviceCertificate` consumes them, and the
    // certificate below is genuine — it is the revocation that refuses it.
    const u = await user();
    const device = await generateIdentityKeyPair(true);
    const certificate = await issueDeviceCertificate({
      rootPrivateKey: u.root.privateKey,
      userId: u.userId,
      devicePublicKey: device.publicKey,
      issuedAt: NOW,
      expiresAt: NOW + HOUR,
    });

    const before = await verifyDeviceCertificate(certificate, {
      rootPublicKey: u.root.publicKey,
      expectedUserId: u.userId,
      now: NOW + 1,
    });
    expect(before.valid).toBe(true);

    const l = await issueRevocationList(
      {
        userId: u.userId,
        revokedDeviceIds: [certificate.deviceId],
        issuedAt: NOW,
        expiresAt: NOW + HOUR,
      },
      u.root.privateKey,
    );
    const verdict = await verifyRevocationList(l, {
      rootPublicKey: u.root.publicKey,
      expectedUserId: u.userId,
      now: NOW + 1,
    });
    expect(verdict.usable).toBe(true);

    const after = await verifyDeviceCertificate(certificate, {
      rootPublicKey: u.root.publicKey,
      expectedUserId: u.userId,
      now: NOW + 1,
      revokedDeviceIds: verdict.revokedDeviceIds,
    });
    expect(after.valid).toBe(false);
    expect(after.rejection).toBe('revoked');
  });
});

describe('what a verifier says when it has nothing usable', () => {
  it('names the tempting fail-open and refuses it in the same sentence', async () => {
    // The shape at a call site would be `list?.revokedDeviceIds ?? []`, which reads as a safe
    // default and is the exact fail-open. The message exists so nobody writes it.
    const message = revocationUnavailable('stale');
    expect(message).toContain('stale');
    expect(message).toContain('nothing is revoked');
  });
});
