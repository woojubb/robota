import {
  StableFileAuthorityError,
  type TStableFileAuthorityErrorCode,
} from '@robota-sdk/agent-file-authority';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceProjectReader } from './project-reader.js';
import { ProjectReadLimitExceededError } from './project-reader-path.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

import type { IWorkspaceIdentity, IWorkspaceIdentityResolver } from './types.js';

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

const identity: IWorkspaceIdentity = {
  repositoryKey: 'test:trusted-root',
  displayPath: '/trusted/root',
  worktreeRoot: '/trusted/root',
};

let activeChecks = 0;
let identityChecks = 0;
const identityResolver: IWorkspaceIdentityResolver = {
  resolve: () => {
    identityChecks += 1;
    return identity;
  },
};

function reader() {
  return createWorkspaceProjectReader(identity, identityResolver, () => {
    activeChecks += 1;
  });
}

afterEach(() => {
  authority.openedRoot = '';
  authority.segments = [];
  authority.maxBytes = -1;
  authority.closeCount = 0;
  authority.bytes = undefined;
  authority.error = undefined;
  activeChecks = 0;
  identityChecks = 0;
});

describe('workspace project reader file authority delegation', () => {
  it('checks authority and identity around one bounded delegated read', () => {
    authority.bytes = Buffer.from('trusted');

    expect(
      Buffer.from(reader().readBytes('nested/file.txt', 'test delegated read', 7) ?? []),
    ).toEqual(Buffer.from('trusted'));
    expect(authority).toMatchObject({
      openedRoot: identity.worktreeRoot,
      segments: ['nested', 'file.txt'],
      maxBytes: 7,
      closeCount: 1,
    });
    expect(activeChecks).toBe(2);
    expect(identityChecks).toBe(2);
  });

  it('maps the leaf budget refusal to the existing project limit error', () => {
    authority.error = new StableFileAuthorityError('OVER_BUDGET', { operation: 'test-read' });

    expect(() => reader().readBytes('file.txt', 'test bounded read', 7)).toThrowError(
      expect.objectContaining<Partial<ProjectReadLimitExceededError>>({
        maxBytes: 7,
        actualBytes: 8n,
      }),
    );
    expect(authority.closeCount).toBe(1);
  });

  it.each<TStableFileAuthorityErrorCode>([
    'INVALID_PATH',
    'UNSAFE_ENTRY',
    'UNSUPPORTED_BACKEND',
    'AUTHORITY_CLOSED',
    'ROOT_CHANGED',
    'FILE_CHANGED',
    'HOST_IO',
  ])('maps %s to a secret-free workspace refusal with the leaf cause', (leafCode) => {
    const leafError = new StableFileAuthorityError(leafCode, { operation: 'test-read' });
    authority.error = leafError;

    try {
      reader().readBytes('nested/file.txt', 'test failed delegated read', 7);
      throw new Error('Expected the delegated read to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceAuthorityRequiredError);
      expect(error).toMatchObject({ cause: leafError });
      expect(String(error)).not.toContain(identity.worktreeRoot);
      expect(String(error)).not.toContain('nested/file.txt');
    }
    expect(authority.closeCount).toBe(1);
  });
});
