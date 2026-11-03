/**
 * The sealer double stands in for the host's keyring in the tests of the packages that write sealed
 * artifacts, so the properties those tests lean on are asserted here once: opaque bytes, owner and
 * kind binding, writing while locked, and the two typed failures.
 */

import { describe, expect, it } from 'vitest';

import { createTestArtifactSealer, openTestWriteGrant } from '../artifact-sealer-double.js';
import * as testing from '../index.js';
import {
  SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
  isArtifactCorruptError,
  isArtifactLockedError,
} from '../../index.js';

import type { IArtifactContext } from '../../index.js';

const context: IArtifactContext = { kind: 'session-record', id: 'session-a' };
const canary = 'CANARY-8f3a-plaintext';

function throwsWith(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('createTestArtifactSealer', () => {
  it('round-trips bytes and lines', () => {
    const sealer = createTestArtifactSealer();
    const bytes = sealer.sealBytes(Buffer.from(canary), context);
    expect(Buffer.from(sealer.openBytes(bytes, context)).toString()).toBe(canary);
    const line = sealer.sealLine(canary, context);
    expect(sealer.openLine(line, context)).toBe(canary);
  });

  it('stores opaque, framed output and two seals of equal plaintext differ', () => {
    const sealer = createTestArtifactSealer();
    const first = sealer.sealBytes(Buffer.from(canary), context);
    const second = sealer.sealBytes(Buffer.from(canary), context);
    expect(sealer.isSealedBytes(first)).toBe(true);
    expect(Buffer.from(first).includes(Buffer.from(canary))).toBe(false);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    const line = sealer.sealLine(canary, context);
    expect(sealer.isSealedLine(line)).toBe(true);
    expect(line).not.toContain(canary);
    expect(line).not.toMatch(/[\r\n]/);
  });

  it('seals while locked and opens only after unlocking', () => {
    const sealer = createTestArtifactSealer({ locked: true });
    const bytes = sealer.sealBytes(Buffer.from(canary), context);
    expect(isArtifactLockedError(throwsWith(() => sealer.openBytes(bytes, context)))).toBe(true);
    sealer.unlock();
    expect(Buffer.from(sealer.openBytes(bytes, context)).toString()).toBe(canary);
    sealer.lock();
    expect(sealer.isLocked).toBe(true);
    expect(isArtifactLockedError(throwsWith(() => sealer.openBytes(bytes, context)))).toBe(true);
  });

  it('refuses an artifact moved to another owner or read as another kind', () => {
    const sealer = createTestArtifactSealer();
    const bytes = sealer.sealBytes(Buffer.from(canary), context);
    const otherOwner = { ...context, id: 'session-b' };
    const otherKind: IArtifactContext = { kind: 'checkpoint-manifest', id: context.id };
    expect(isArtifactCorruptError(throwsWith(() => sealer.openBytes(bytes, otherOwner)))).toBe(
      true,
    );
    expect(isArtifactCorruptError(throwsWith(() => sealer.openBytes(bytes, otherKind)))).toBe(true);
  });

  it('refuses tampered, truncated and unsealed input', () => {
    const sealer = createTestArtifactSealer();
    const bytes = Buffer.from(sealer.sealBytes(Buffer.from(canary), context));
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 1] ^= 0x01;
    for (const damaged of [flipped, bytes.subarray(0, bytes.length - 3), Buffer.from('{"a":1}')]) {
      expect(isArtifactCorruptError(throwsWith(() => sealer.openBytes(damaged, context)))).toBe(
        true,
      );
    }
  });

  it('shares a keyring between doubles that share a key and not otherwise', () => {
    const key = Buffer.alloc(32, 7);
    const writer = createTestArtifactSealer({ key });
    const sameKeyring = createTestArtifactSealer({ key });
    const otherKeyring = createTestArtifactSealer();
    const bytes = writer.sealBytes(Buffer.from(canary), context);
    expect(Buffer.from(sameKeyring.openBytes(bytes, context)).toString()).toBe(canary);
    expect(isArtifactCorruptError(throwsWith(() => otherKeyring.openBytes(bytes, context)))).toBe(
      true,
    );
  });

  it('rejects an id that could blur the binding', () => {
    const sealer = createTestArtifactSealer();
    expect(() => sealer.sealBytes(Buffer.from('x'), { kind: 'session-record', id: 'a|b' })).toThrow(
      RangeError,
    );
    expect(() => sealer.sealBytes(Buffer.from('x'), { kind: 'session-record', id: '' })).toThrow(
      RangeError,
    );
  });

  it('adds far less than the bound any sealer stays under', () => {
    const sealer = createTestArtifactSealer();
    for (const size of [0, 1, 4096]) {
      const overhead = sealer.sealBytes(new Uint8Array(size), context).length - size;
      expect(overhead).toBeLessThan(SEALED_ARTIFACT_MAX_OVERHEAD_BYTES);
    }
  });
});

describe('openTestWriteGrant', () => {
  const key = Buffer.alloc(32, 0x5a);

  it('issues an in-process handle that carries none of the key', () => {
    const sealer = createTestArtifactSealer({ key });
    const grant = sealer.writeGrant();
    expect(grant).toMatch(/^robota-test-grant\/v1:[A-Za-z0-9-]+$/);
    expect(sealer.writeGrant()).toBe(grant);
    for (const encoding of ['hex', 'base64', 'base64url', 'latin1'] as const) {
      expect(grant).not.toContain(key.toString(encoding));
    }
    expect(createTestArtifactSealer({ key }).writeGrant()).not.toBe(grant);
    expect(testing.openTestWriteGrant).toBe(openTestWriteGrant);
  });

  it('turns the grant into a write-only twin whose seals the double opens', () => {
    const double = createTestArtifactSealer();
    const twin = openTestWriteGrant(double.writeGrant());
    const bytes = twin.sealBytes(Buffer.from(canary), context);
    const line = twin.sealLine(canary, context);
    expect(Buffer.from(double.openBytes(bytes, context)).toString()).toBe(canary);
    expect(double.openLine(line, context)).toBe(canary);
    expect(twin.writeGrant?.()).toBe(double.writeGrant());
  });

  it('never opens anything, and says it holds no keys rather than that they are locked', () => {
    const double = createTestArtifactSealer();
    const twin = openTestWriteGrant(double.writeGrant());
    for (const open of [
      () => twin.openBytes(twin.sealBytes(Buffer.from(canary), context), context),
      () => twin.openLine(twin.sealLine(canary, context), context),
      () => twin.openBytes(double.sealBytes(Buffer.from(canary), context), context),
    ]) {
      const error = throwsWith(open);
      expect(isArtifactLockedError(error)).toBe(true);
      expect((error as { reason?: unknown }).reason).toBe('no-keys');
    }
    expect(isArtifactCorruptError(throwsWith(() => twin.openLine('{"a":1}', context)))).toBe(true);
  });

  it('refuses a grant this process did not issue', () => {
    for (const grant of ['robota-test-grant/v1:unknown', 'rsg1.AAAA', '']) {
      expect(() => openTestWriteGrant(grant)).toThrow(RangeError);
    }
  });
});
