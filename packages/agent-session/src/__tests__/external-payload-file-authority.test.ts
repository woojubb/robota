import { resolve } from 'node:path';

import {
  StableFileAuthorityError,
  type TStableFileAuthorityErrorCode,
} from '@robota-sdk/agent-file-authority';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionLogPayloadResolutionError } from '../external-payload-resolution-contracts.js';
import { NodeExternalPayloadSource } from '../session-log-sources.js';

const authority = vi.hoisted(() => ({
  openedRoot: '',
  segments: [] as string[],
  maxBytes: -1,
  closeCount: 0,
  bytes: undefined as Uint8Array | undefined,
  error: undefined as unknown,
}));

vi.mock('@robota-sdk/agent-file-authority', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-file-authority')>();
  return {
    ...actual,
    createStableRootedFileReader: (rootDirectory: string) => {
      authority.openedRoot = rootDirectory;
      const close = (): void => {
        authority.closeCount += 1;
      };
      return {
        readBytes: (segments: readonly string[], maxBytes: number): Uint8Array | undefined => {
          authority.segments = [...segments];
          authority.maxBytes = maxBytes;
          if (authority.error !== undefined) throw authority.error;
          return authority.bytes;
        },
        close,
        [Symbol.dispose]: close,
      };
    },
  };
});

afterEach(() => {
  authority.openedRoot = '';
  authority.segments = [];
  authority.maxBytes = -1;
  authority.closeCount = 0;
  authority.bytes = undefined;
  authority.error = undefined;
});

describe('NodeExternalPayloadSource file authority delegation', () => {
  it('delegates segments and the mandatory budget, then closes the authority', () => {
    authority.bytes = Buffer.from('payload');
    const source = new NodeExternalPayloadSource('payload-root');

    expect(Buffer.from(source.readBytes('nested/payload.json', 7) ?? []).toString()).toBe(
      'payload',
    );
    expect(authority.openedRoot).toBe(resolve('payload-root'));
    expect(authority.segments).toEqual(['nested', 'payload.json']);
    expect(authority.maxBytes).toBe(7);
    expect(authority.closeCount).toBe(1);
  });

  it.each<[TStableFileAuthorityErrorCode, SessionLogPayloadResolutionError['code']]>([
    ['INVALID_PATH', 'OUTSIDE_ROOT'],
    ['UNSAFE_ENTRY', 'OUTSIDE_ROOT'],
    ['UNSUPPORTED_BACKEND', 'STABLE_PAYLOAD_READ_UNAVAILABLE'],
    ['OVER_BUDGET', 'MAX_TOTAL_BYTES_EXCEEDED'],
    ['AUTHORITY_CLOSED', 'PAYLOAD_UNREADABLE'],
    ['ROOT_CHANGED', 'PAYLOAD_UNREADABLE'],
    ['FILE_CHANGED', 'PAYLOAD_UNREADABLE'],
    ['HOST_IO', 'PAYLOAD_UNREADABLE'],
  ])('maps %s to %s without losing its safe cause', (leafCode, sessionCode) => {
    const leafError = new StableFileAuthorityError(leafCode, { operation: 'test-read' });
    authority.error = leafError;

    try {
      new NodeExternalPayloadSource('payload-root').readBytes('payload.json', 16);
      throw new Error('Expected the delegated read to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: sessionCode, cause: leafError });
    }
    expect(authority.closeCount).toBe(1);
  });
});
