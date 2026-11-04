/**
 * The Node adapter that turns a project state directory into an absolute path, after proving that no
 * segment from the trusted root down to it is a link or anything but a directory: such a segment
 * would put what is kept there outside the project.
 */

import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeWorkspaceProjectFiles } from './node-project-files.js';
import { workspaceProjectStateDirectoryPath } from './node-project-state-directory.js';
import { getWorkspaceProjectStateStorage } from './project-state-storage.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
import { WorkspaceTrustService } from './workspace-trust-service.js';
import { createTrustedProjectStateFixture } from '../testing/trusted-project-state-fixture.js';

import type { IWorkspaceIdentity } from './types.js';

const REFUSAL = /link or not a directory/u;

let root: string;
const extras: string[] = [];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'node-project-state-directory-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const extra of extras.splice(0)) rmSync(extra, { recursive: true, force: true });
});

describe('workspaceProjectStateDirectoryPath', () => {
  it('returns the directory under the root when every segment is a real directory', async () => {
    mkdirSync(join(root, '.agent', 'sessions', 'claims'), { recursive: true });
    const storage = await createTrustedProjectStateFixture(root, 'sessions');

    expect(workspaceProjectStateDirectoryPath(storage, 'claims')).toBe(
      join(root, '.agent', 'sessions', 'claims'),
    );
  });

  it('stops at the first segment that is not made yet, and makes nothing', async () => {
    mkdirSync(join(root, '.agent'));
    const storage = await createTrustedProjectStateFixture(root, 'sessions');

    expect(workspaceProjectStateDirectoryPath(storage, 'claims')).toBe(
      join(root, '.agent', 'sessions', 'claims'),
    );
    expect(existsSync(join(root, '.agent', 'sessions'))).toBe(false);
  });

  it('refuses a directory reached through a link, which could lie outside the project', async () => {
    mkdirSync(join(root, '.agent'));
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'project-state-elsewhere-')));
    extras.push(elsewhere);
    symlinkSync(elsewhere, join(root, '.agent', 'sessions'), 'dir');
    const storage = await createTrustedProjectStateFixture(root, 'sessions');

    expect(() => workspaceProjectStateDirectoryPath(storage, 'claims')).toThrow(
      WorkspaceAuthorityRequiredError,
    );
    expect(() => workspaceProjectStateDirectoryPath(storage, 'claims')).toThrow(REFUSAL);
  });

  it('refuses a segment that is a file, not a directory', async () => {
    mkdirSync(join(root, '.agent'));
    writeFileSync(join(root, '.agent', 'sessions'), 'not a directory');
    const storage = await createTrustedProjectStateFixture(root, 'sessions');

    expect(() => workspaceProjectStateDirectoryPath(storage, 'claims')).toThrow(REFUSAL);
  });
});

/**
 * A host keeps the spelling of its own layout: a Windows host's `.agent\sessions`, or a `/` layout
 * on a host whose roots use `\`. The walk takes its segments from the same splitter the reader uses,
 * never from a split on this platform's separator, so every segment is checked whichever way the
 * layout is spelled.
 */
describe('workspaceProjectStateDirectoryPath on a layout the host spelled with the other separator', () => {
  async function storageOver(layout: string): Promise<ReturnType<typeof getWorkspaceProjectStateStorage>> {
    const identity: IWorkspaceIdentity = {
      repositoryKey: `test:${root}`,
      displayPath: root,
      worktreeRoot: root,
    };
    const trust = new WorkspaceTrustService({
      projectFiles: createNodeWorkspaceProjectFiles(),
      identityResolver: { resolve: () => identity },
      store: {
        inspect: async () => ({ state: 'trusted', generation: 1 }),
        grant: async () => ({ state: 'trusted', generation: 1 }),
        revoke: async () => ({ state: 'revoked', generation: 2 }),
      },
      projectStateDirectories: {
        sessions: layout,
        'session-logs': '.agent\\logs',
        memory: '.agent\\memory',
        checkpoints: '.agent\\checkpoints',
      },
    });
    const access = await trust.inspect(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    return getWorkspaceProjectStateStorage(access.authority, 'sessions');
  }

  it('refuses a link at an intermediate segment of a backslash-spelled layout', async () => {
    mkdirSync(join(root, '.agent'));
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'project-state-elsewhere-')));
    extras.push(elsewhere);
    symlinkSync(elsewhere, join(root, '.agent', 'sessions'), 'dir');
    const storage = await storageOver('.agent\\sessions');

    expect(() => workspaceProjectStateDirectoryPath(storage, 'claims')).toThrow(
      WorkspaceAuthorityRequiredError,
    );
  });

  it('refuses a link at the first segment of a backslash-spelled layout', async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'project-state-elsewhere-')));
    extras.push(elsewhere);
    symlinkSync(elsewhere, join(root, '.agent'), 'dir');
    const storage = await storageOver('.agent\\sessions');

    expect(() => workspaceProjectStateDirectoryPath(storage, 'claims')).toThrow(REFUSAL);
  });

  it('returns the same path for the backslash-spelled layout as for the slash-spelled one', async () => {
    mkdirSync(join(root, '.agent', 'sessions'), { recursive: true });
    const storage = await storageOver('.agent\\sessions');

    expect(workspaceProjectStateDirectoryPath(storage, 'claims')).toBe(
      join(root, '.agent', 'sessions', 'claims'),
    );
  });
});
