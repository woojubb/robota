import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveSessionLogExternalPayloads,
  type SessionLogPayloadResolutionError,
  type TSessionLogPayloadResolutionErrorCode,
} from '../external-payload-resolver.js';

import type { IExternalPayloadReference } from '../session-logger.js';
import { NodeExternalPayloadSource } from '../session-log-sources.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('resolveSessionLogExternalPayloads', () => {
  it('ARCH-014: resolves a valid content-addressed JSON sidecar', () => {
    const baseDirectory = mkdtempSync(join(tmpdir(), 'robota-payload-resolver-'));
    temporaryDirectories.push(baseDirectory);
    const payloadDirectory = join(baseDirectory, 'session.payloads');
    mkdirSync(payloadDirectory);
    const serialized = JSON.stringify({ content: 'restored' });
    const sha256 = createHash('sha256').update(serialized).digest('hex');
    const relativePath = join('session.payloads', `${sha256}.json`);
    writeFileSync(join(baseDirectory, relativePath), serialized);
    const reference: IExternalPayloadReference = {
      kind: 'external-payload',
      encoding: 'json',
      sha256,
      byteLength: Buffer.byteLength(serialized),
      relativePath,
    };

    expect(resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory))).toEqual({
      content: 'restored',
    });
  });

  it('ARCH-014: recursively resolves references nested through another sidecar', () => {
    const baseDirectory = createTemporaryDirectory();
    const inner = writePayload(baseDirectory, 'inner value', 'inner.json');
    const outer = writePayload(baseDirectory, { nested: inner }, 'outer.json');

    expect(
      resolveSessionLogExternalPayloads({ payload: outer }, payloadOptions(baseDirectory)),
    ).toEqual({
      payload: { nested: 'inner value' },
    });
  });

  it('ARCH-014: rejects malformed reference shapes', () => {
    const baseDirectory = createTemporaryDirectory();
    const reference = { ...writePayload(baseDirectory, 'value'), extra: true };

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory)),
      'INVALID_REFERENCE',
    );
  });

  it('ARCH-014: reports a missing payload', () => {
    const baseDirectory = createTemporaryDirectory();
    const reference = createReference('missing.json', 'a'.repeat(64), 1);

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory)),
      'PAYLOAD_NOT_FOUND',
    );
  });

  it('ARCH-014: rejects a payload path that resolves to a non-file', () => {
    const baseDirectory = createTemporaryDirectory();
    mkdirSync(join(baseDirectory, 'payload-directory'));
    const reference = createReference('payload-directory', 'a'.repeat(64), 0);

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory)),
      'PAYLOAD_UNREADABLE',
    );
  });

  it('ARCH-014: rejects lexical traversal', () => {
    const baseDirectory = createTemporaryDirectory();
    const reference = createReference('../outside.json', 'a'.repeat(64), 1);

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory)),
      'OUTSIDE_ROOT',
    );
  });

  it('ARCH-014: rejects a symlink target outside the base directory', () => {
    const baseDirectory = createTemporaryDirectory();
    const outsideDirectory = createTemporaryDirectory();
    const outsidePath = join(outsideDirectory, 'outside.json');
    const serialized = JSON.stringify('outside');
    writeFileSync(outsidePath, serialized);
    symlinkSync(outsidePath, join(baseDirectory, 'linked.json'));
    const reference = createReference(
      'linked.json',
      createHash('sha256').update(serialized).digest('hex'),
      Buffer.byteLength(serialized),
    );

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory)),
      'OUTSIDE_ROOT',
    );
  });

  it('ARCH-014: rejects byte-length and sha256 mismatches independently', () => {
    const baseDirectory = createTemporaryDirectory();
    const reference = writePayload(baseDirectory, 'integrity');

    expectResolutionCode(
      () =>
        resolveSessionLogExternalPayloads(
          { ...reference, byteLength: reference.byteLength + 1 },
          payloadOptions(baseDirectory),
        ),
      'BYTE_LENGTH_MISMATCH',
    );
    expectResolutionCode(
      () =>
        resolveSessionLogExternalPayloads(
          { ...reference, sha256: 'b'.repeat(64) },
          payloadOptions(baseDirectory),
        ),
      'SHA256_MISMATCH',
    );
  });

  it('ARCH-014: rejects integrity-valid bytes that are not JSON', () => {
    const baseDirectory = createTemporaryDirectory();
    const invalidJson = Buffer.from('{');
    writeFileSync(join(baseDirectory, 'invalid.json'), invalidJson);
    const reference = createReference(
      'invalid.json',
      createHash('sha256').update(invalidJson).digest('hex'),
      invalidJson.byteLength,
    );

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(reference, payloadOptions(baseDirectory)),
      'INVALID_JSON',
    );
  });

  it('ARCH-014: enforces nested-reference depth and aggregate byte limits', () => {
    const baseDirectory = createTemporaryDirectory();
    const inner = writePayload(baseDirectory, 'inner value', 'inner.json');
    const outer = writePayload(baseDirectory, { nested: inner }, 'outer.json');

    expectResolutionCode(
      () =>
        resolveSessionLogExternalPayloads(outer, {
          ...payloadOptions(baseDirectory),
          maxDepth: 1,
        }),
      'MAX_DEPTH_EXCEEDED',
    );
    expectResolutionCode(
      () =>
        resolveSessionLogExternalPayloads(outer, {
          ...payloadOptions(baseDirectory),
          maxTotalBytes: outer.byteLength - 1,
        }),
      'MAX_TOTAL_BYTES_EXCEEDED',
    );
  });

  it('ARCH-014: rejects circular in-memory values and invalid limits', () => {
    const baseDirectory = createTemporaryDirectory();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expectResolutionCode(
      () => resolveSessionLogExternalPayloads(circular, payloadOptions(baseDirectory)),
      'CIRCULAR_REFERENCE',
    );
    for (const maxDepth of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expectResolutionCode(
        () =>
          resolveSessionLogExternalPayloads(
            {},
            {
              ...payloadOptions(baseDirectory),
              maxDepth,
            },
          ),
        'INVALID_LIMIT',
      );
    }
  });
});

function payloadOptions(baseDirectory: string): { source: NodeExternalPayloadSource } {
  return { source: new NodeExternalPayloadSource(baseDirectory) };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'robota-payload-resolver-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writePayload(
  baseDirectory: string,
  value: unknown,
  relativePath = 'payload.json',
): IExternalPayloadReference {
  const serialized = JSON.stringify(value);
  writeFileSync(join(baseDirectory, relativePath), serialized);
  return createReference(
    relativePath,
    createHash('sha256').update(serialized).digest('hex'),
    Buffer.byteLength(serialized),
  );
}

function createReference(
  relativePath: string,
  sha256: string,
  byteLength: number,
): IExternalPayloadReference {
  return { kind: 'external-payload', encoding: 'json', sha256, byteLength, relativePath };
}

function expectResolutionCode(
  operation: () => unknown,
  code: TSessionLogPayloadResolutionErrorCode,
): void {
  expect(operation).toThrowError(
    expect.objectContaining<Partial<SessionLogPayloadResolutionError>>({ code }),
  );
}
