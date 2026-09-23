import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  createWorkspaceProjectMutation,
  createWorkspaceProjectSettingsWriter,
  getWorkspaceProjectStateStorage,
} from '../src/index.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
} from '../src/index.js';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryTrustStore implements IWorkspaceTrustStore {
  private snapshot: IWorkspaceTrustStoreSnapshot = { state: 'untrusted', generation: 0 };

  inspect(): Promise<IWorkspaceTrustStoreSnapshot> {
    return Promise.resolve(this.snapshot);
  }

  grant(
    _identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    assertCondition(expectedGeneration === this.snapshot.generation, 'unexpected trust generation');
    this.snapshot = {
      state: 'trusted',
      generation: expectedGeneration + 1,
      grantedAt: '2026-09-10T00:00:00.000Z',
    };
    return Promise.resolve(this.snapshot);
  }

  revoke(
    _identity: IWorkspaceIdentity,
    expectedGeneration: number,
  ): Promise<IWorkspaceTrustStoreSnapshot> {
    assertCondition(expectedGeneration === this.snapshot.generation, 'unexpected trust generation');
    this.snapshot = { state: 'revoked', generation: expectedGeneration + 1 };
    return Promise.resolve(this.snapshot);
  }
}

function createIdentityResolver(root: string): IWorkspaceIdentityResolver {
  const identity = Object.freeze({
    repositoryKey: `example:${root}`,
    displayPath: root,
    worktreeRoot: root,
  });
  return { resolve: () => identity };
}

async function main(): Promise<void> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'arch-2151-project-mutation-'));
  const workspacePath = join(temporaryRoot, 'workspace-a');
  const outsidePath = join(temporaryRoot, 'workspace-b');
  mkdirSync(workspacePath);
  mkdirSync(outsidePath);
  const workspaceRoot = realpathSync(workspacePath);
  const outsideRoot = realpathSync(outsidePath);
  writeFileSync(join(outsideRoot, 'canary.txt'), 'workspace-b canary\n', 'utf8');

  const resolver = createIdentityResolver(workspaceRoot);
  const service = new WorkspaceTrustService({
    identityResolver: resolver,
    store: new MemoryTrustStore(),
  });
  let revoked = false;

  try {
    const access = await service.grant(workspaceRoot);
    assertCondition(access.status === 'trusted', 'workspace grant was not trusted');
    const mutation = createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'ARCH-2151 public mutation scenario',
    });
    const settings = createWorkspaceProjectSettingsWriter(access.authority, {
      status: 'approved',
      target: 'project-local',
      purpose: 'ARCH-2151 public settings scenario',
    });
    const sessions = getWorkspaceProjectStateStorage(access.authority, 'sessions');
    const outcomes: string[] = [];

    try {
      mutation.writeBytes('safe/entry.txt', Buffer.from('workspace-a\n'), 'create safe entry');
      outcomes.push('safe-write=inside');
      mutation.deleteFile('safe/entry.txt', 'delete safe entry');
      outcomes.push('safe-delete=inside');
    } catch (error) {
      if (!(error instanceof WorkspaceAuthorityRequiredError)) throw error;
      outcomes.push('safe-mutation=refused');
    }

    try {
      sessions.appendText('events.log', 'event\n', 'append safe event');
      settings.writeText('{"safe":true}\n');
      outcomes.push('consumer-writes=inside');
    } catch (error) {
      if (!(error instanceof WorkspaceAuthorityRequiredError)) throw error;
      outcomes.push('consumer-writes=refused');
    }

    mkdirSync(join(workspaceRoot, 'parent-link-fixture'));
    rmSync(join(workspaceRoot, 'parent-link-fixture'), { recursive: true, force: true });
    symlinkSync(outsideRoot, join(workspaceRoot, 'parent-link-fixture'), 'dir');
    try {
      mutation.writeBytes(
        'parent-link-fixture/entry.txt',
        Buffer.from('must not escape'),
        'parent swap',
      );
      throw new Error('parent link mutation was unexpectedly accepted');
    } catch (error) {
      if (!(error instanceof WorkspaceAuthorityRequiredError)) throw error;
      outcomes.push('parent-swap=refused');
    }

    symlinkSync(join(outsideRoot, 'canary.txt'), join(workspaceRoot, 'target-link.txt'));
    try {
      mutation.writeBytes('target-link.txt', Buffer.from('must not escape'), 'target swap');
      throw new Error('target link mutation was unexpectedly accepted');
    } catch (error) {
      if (!(error instanceof WorkspaceAuthorityRequiredError)) throw error;
      outcomes.push('target-swap=refused');
    }

    assertCondition(
      readFileSync(join(outsideRoot, 'canary.txt'), 'utf8') === 'workspace-b canary\n',
      'workspace B canary changed',
    );
    assertCondition(
      !existsSync(join(outsideRoot, 'entry.txt')),
      'workspace B received an authority-bearing mutation',
    );
    const workspaceBUnchanged =
      readFileSync(join(outsideRoot, 'canary.txt'), 'utf8') === 'workspace-b canary\n';
    assertCondition(workspaceBUnchanged, 'workspace B was not unchanged');

    await service.revoke(workspaceRoot);
    revoked = true;
    process.stdout.write(
      `result=workspace-confined; workspace-b-unchanged=${workspaceBUnchanged}; platform=${process.platform}; ${outcomes.join('; ')}\n`,
    );
  } finally {
    if (!revoked) {
      try {
        await service.revoke(workspaceRoot);
      } catch {
        // Cleanup must still remove the isolated fixture when the scenario fails.
      }
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  assertCondition(!existsSync(temporaryRoot), 'scenario cleanup left temporary workspaces behind');
}

await main();
