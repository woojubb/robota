/**
 * The artifact-sealer port's two failures and its framing, which readers without a sealer rely on.
 *
 * A caller decides on the typed `code`, so the codes and the fixed messages are the contract; and a
 * store that holds no keys tells "sealed" from "damaged" by the framing alone, so the framing checks
 * must be exact and must not depend on a sealer instance.
 */

import { describe, expect, it } from 'vitest';

import {
  ArtifactCorruptError,
  ArtifactLockedError,
  isArtifactCorruptError,
  isArtifactLockedError,
} from './artifact-sealer-errors.js';
import {
  SEALED_ARTIFACT_LINE_PREFIX,
  SEALED_ARTIFACT_MAGIC,
  SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
  isCurrentSealedArtifactBytes,
  isCurrentSealedArtifactLine,
  isSealedArtifactBytes,
  isSealedArtifactLine,
} from './sealed-artifact-framing.js';
import * as foundation from '../index.js';
import { ARTIFACT_KEY_REUSE } from '../interfaces/artifact-sealer.js';

import type { TArtifactKind } from '../interfaces/artifact-sealer.js';

describe('artifact sealer errors', () => {
  it('ArtifactLockedError carries the ARTIFACT_LOCKED code and a fixed message', () => {
    const error = new ArtifactLockedError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ArtifactLockedError');
    expect(error.code).toBe('ARTIFACT_LOCKED');
    expect(error.message).toBe('The artifact is sealed and the keys are locked.');
  });

  it('ArtifactCorruptError carries the ARTIFACT_CORRUPT code and a fixed message', () => {
    const error = new ArtifactCorruptError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ArtifactCorruptError');
    expect(error.code).toBe('ARTIFACT_CORRUPT');
    expect(error.message).toBe(
      'The sealed artifact does not open: it is damaged, or not bound to this owner and kind.',
    );
  });

  it('neither error chains a cause or takes any content', () => {
    expect(new ArtifactLockedError().cause).toBeUndefined();
    expect(new ArtifactCorruptError().cause).toBeUndefined();
    expect(ArtifactLockedError.length).toBe(0);
    expect(ArtifactCorruptError.length).toBe(0);
  });

  it('the predicates decide on the code, so another copy of the class still matches', () => {
    class OtherCopy extends Error {
      readonly code = 'ARTIFACT_LOCKED';
    }
    expect(isArtifactLockedError(new ArtifactLockedError())).toBe(true);
    expect(isArtifactLockedError(new OtherCopy())).toBe(true);
    expect(isArtifactLockedError(new ArtifactCorruptError())).toBe(false);
    expect(isArtifactCorruptError(new ArtifactCorruptError())).toBe(true);
    expect(isArtifactCorruptError(new ArtifactLockedError())).toBe(false);
  });

  it('the predicates refuse values that are not errors with a code', () => {
    for (const value of [undefined, null, 'ARTIFACT_LOCKED', 42, {}, { code: 'OTHER' }]) {
      expect(isArtifactLockedError(value)).toBe(false);
      expect(isArtifactCorruptError(value)).toBe(false);
    }
  });
});

describe('sealed artifact framing', () => {
  it('names the version in the magic, and the line prefix is the magic and a colon', () => {
    expect(SEALED_ARTIFACT_MAGIC).toBe('RSL1');
    expect(SEALED_ARTIFACT_LINE_PREFIX).toBe('RSL1:');
  });

  it('recognises bytes that start with the magic, whatever follows', () => {
    expect(isSealedArtifactBytes(Buffer.from('RSL1'))).toBe(true);
    expect(isSealedArtifactBytes(Buffer.from('RSL1\u0000ÿ anything'))).toBe(true);
  });

  it('recognises a later framing version as sealed, so an older reader never takes it for plaintext', () => {
    expect(isSealedArtifactBytes(Buffer.from('RSL2'))).toBe(true);
    expect(isSealedArtifactBytes(Buffer.from('RSL9 anything'))).toBe(true);
    expect(isSealedArtifactLine('RSL2:abc')).toBe(true);
    expect(isSealedArtifactLine('RSL7:')).toBe(true);
    // Only the version this build writes is one it can open.
    expect(isCurrentSealedArtifactBytes(Buffer.from('RSL1 anything'))).toBe(true);
    expect(isCurrentSealedArtifactBytes(Buffer.from('RSL2 anything'))).toBe(false);
    expect(isCurrentSealedArtifactLine('RSL1:abc')).toBe(true);
    expect(isCurrentSealedArtifactLine('RSL2:abc')).toBe(false);
  });

  it('does not recognise plaintext, a near miss, or a value too short to hold the magic', () => {
    expect(isSealedArtifactBytes(Buffer.from('{"schemaVersion":2}'))).toBe(false);
    expect(isSealedArtifactBytes(Buffer.from('RSLx'))).toBe(false);
    expect(isSealedArtifactBytes(Buffer.from('rsl1'))).toBe(false);
    expect(isSealedArtifactBytes(Buffer.from(' RSL1'))).toBe(false);
    expect(isSealedArtifactBytes(Buffer.from('RSL'))).toBe(false);
    expect(isSealedArtifactBytes(new Uint8Array(0))).toBe(false);
    expect(isCurrentSealedArtifactBytes(Buffer.from('RSL'))).toBe(false);
  });

  it('recognises a line that starts with the prefix and nothing else', () => {
    expect(isSealedArtifactLine('RSL1:abc')).toBe(true);
    expect(isSealedArtifactLine('RSL1:')).toBe(true);
    expect(isSealedArtifactLine('RSL1')).toBe(false);
    expect(isSealedArtifactLine('RSL2')).toBe(false);
    expect(isSealedArtifactLine('RSLx:abc')).toBe(false);
    expect(isSealedArtifactLine(' RSL1:abc')).toBe(false);
    expect(isSealedArtifactLine('{"type":"line"}')).toBe(false);
    expect(isSealedArtifactLine('')).toBe(false);
  });

  it('bounds any sealer overhead generously, so a reader can size a raw read from a plaintext budget', () => {
    expect(SEALED_ARTIFACT_MAX_OVERHEAD_BYTES).toBe(4096);
    expect(foundation.SEALED_ARTIFACT_MAX_OVERHEAD_BYTES).toBe(4096);
  });
});

describe('artifact key reuse policy', () => {
  it('lets the append-only kinds share a writer epoch and gives whole artifacts a fresh key', () => {
    const expected: Record<TArtifactKind, 'writer-epoch' | 'fresh'> = {
      'session-record': 'fresh',
      'prompt-history-line': 'writer-epoch',
      'session-log-line': 'writer-epoch',
      'session-log-payload': 'writer-epoch',
      'checkpoint-manifest': 'fresh',
      'checkpoint-preimage': 'fresh',
      'tool-result-spill': 'fresh',
    };
    expect({ ...ARTIFACT_KEY_REUSE }).toEqual(expected);
    expect(foundation.ARTIFACT_KEY_REUSE).toBe(ARTIFACT_KEY_REUSE);
    // A sealer reads it on every seal; it cannot be changed under one at run time.
    expect(Object.isFrozen(ARTIFACT_KEY_REUSE)).toBe(true);
  });
});

describe('the reason an artifact is locked', () => {
  it('is "locked" unless said otherwise, so existing callers keep their meaning', () => {
    const error = new ArtifactLockedError();
    expect(error.reason).toBe('locked');
    expect(error.message).toBe('The artifact is sealed and the keys are locked.');
  });

  it('says "no-keys" for a process that holds no keys at all, with its own fixed text', () => {
    const error = new ArtifactLockedError('no-keys');
    expect(error.reason).toBe('no-keys');
    expect(error.code).toBe('ARTIFACT_LOCKED');
    expect(error.message).toBe('The artifact is sealed and this process holds no keys to open it.');
    expect(error.cause).toBeUndefined();
    expect(isArtifactLockedError(error)).toBe(true);
    expect(isArtifactCorruptError(error)).toBe(false);
  });

  it('never words a reason it does not know into the message', () => {
    const error = new ArtifactLockedError('CANARY-reason' as never);
    expect(error.reason).toBe('locked');
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('CANARY');
  });
});
