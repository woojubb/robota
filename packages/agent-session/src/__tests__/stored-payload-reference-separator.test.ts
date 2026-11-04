import { describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@robota-sdk/agent-core';

import { StoredPayloads } from '../stored-append-lines.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';

// A Windows host's `node:path`, so a reference built with the platform separator shows on any host.
vi.mock('node:path', async (importOriginal) => {
  const path = await importOriginal<typeof import('node:path')>();
  return { ...path.win32, default: path.win32 };
});

const sealer = {
  sealBytes: (bytes: Uint8Array) => Uint8Array.from(bytes),
  openBytes: (bytes: Uint8Array) => Uint8Array.from(bytes),
} as unknown as IArtifactSealer;

describe('a payload reference is read back on any platform', () => {
  const serialized = JSON.stringify({ value: 'payload' });

  it.each([
    ['plain', 'plain' as const, /^session_1\.payloads\/[0-9a-f]{64}\.json$/],
    ['sealed', { sealer }, /^session_1\.payloads\/[A-Za-z0-9_-]{22}\.sealed$/],
  ])('a %s reference is written with /', (_name, sealing, expected) => {
    const reference = new StoredPayloads(sealing).place(
      'session_1',
      sha256Hex(serialized),
      serialized,
      () => undefined,
    );
    expect(reference.relativePath).toMatch(expected);
  });
});
