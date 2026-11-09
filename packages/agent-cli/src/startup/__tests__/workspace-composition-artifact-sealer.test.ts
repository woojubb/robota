/**
 * One place decides how the CLI's session stores seal (secure conversation). The composition and
 * every command that reads saved sessions build their stores through the product factory, and the
 * factory asks one resolver; so when that resolver answers with a sealer, BOTH stores the composition
 * builds (the user's directory and the trusted project's) seal, and so does a command's own store.
 * The resolver is replaced here because nothing in the product answers with a sealer yet; that it
 * answers plain today is asserted in `product/__tests__/session-stores.test.ts`.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import {
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { productProjectStateDirectories } from '../../product/project-state-directories.js';
import { createProductUserSessionStore } from '../../product/session-stores.js';
import {
  createCliWorkspaceComposition,
  createInitialCliWorkspaceComposition,
} from '../workspace-project-composition.js';

import { createNodeWorkspaceProjectFiles } from '@robota-sdk/agent-framework/node';
import type { IWorkspaceIdentity, IWorkspaceTrustStoreSnapshot } from '@robota-sdk/agent-framework';
import type { TArtifactSealing } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const resolver = vi.hoisted(() => ({ sealing: 'plain' as unknown }));

vi.mock('../../product/session-sealing.js', () => ({
  resolveProductSessionSealing: () => resolver.sealing,
}));

const CANARY = 'CANARY-31f0-composition-conversation';
const STATE = productProjectStateDirectories(createTestProductRuntime());
const roots: string[] = [];

afterEach(() => {
  resolver.sealing = 'plain';
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sealWith(sealer: ReturnType<typeof createTestArtifactSealer>): void {
  resolver.sealing = { sealer } satisfies TArtifactSealing;
}

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: CANARY,
        timestamp: new Date('2026-08-22T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

async function trustedAccess(root: string) {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  const snapshot: IWorkspaceTrustStoreSnapshot = {
    state: 'trusted',
    generation: 1,
    grantedAt: '2026-08-22T00:00:00.000Z',
  };
  return new WorkspaceTrustService({
    projectFiles: createNodeWorkspaceProjectFiles(),
    identityResolver: { resolve: () => identity },
    projectStateDirectories: STATE,
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked', generation: 2 }),
    },
  }).inspect(root);
}

const userSessionsDirectory = (home: string): string => join(home, '.test-product', 'sessions');

describe('the user session store reached through the composition', () => {
  it('writes plain records when the resolver answers plain', () => {
    const home = tempRoot('composition-seal-home-');
    const cwd = tempRoot('composition-seal-cwd-');
    const composition = createCliWorkspaceComposition({
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      cwd,
      userHome: home,
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    });

    composition.sessionStore.save(record('sess_a'));

    const onDisk = readFileSync(join(userSessionsDirectory(home), 'sess_a.json'), 'utf8');
    expect(JSON.parse(onDisk).record.messages[0].content).toBe(CANARY);
  });

  it('seals every record when the resolver answers with a sealer, and reads them back', () => {
    const home = tempRoot('composition-seal-home-');
    const cwd = tempRoot('composition-seal-cwd-');
    const artifactSealer = createTestArtifactSealer();
    sealWith(artifactSealer);
    const composition = createCliWorkspaceComposition({
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      cwd,
      userHome: home,
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    });

    composition.sessionStore.save(record('sess_a'));

    const bytes = readFileSync(join(userSessionsDirectory(home), 'sess_a.json'));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RSL1');
    expect(bytes.includes(Buffer.from(CANARY))).toBe(false);
    // Saved with no stated provenance, so the store cannot vouch that it is the owner's.
    expect(composition.sessionStore.load('sess_a')).toEqual({
      status: 'valid',
      record: record('sess_a'),
      authorship: 'unverified',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    artifactSealer.lock();
    expect(composition.sessionStore.load('sess_a')).toEqual({ status: 'locked' });
  });

  it('seals the user store a trusted workspace falls back to where project writes are unavailable', async () => {
    const home = tempRoot('composition-seal-home-');
    const cwd = tempRoot('composition-seal-cwd-');
    const access = await trustedAccess(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted access.');
    sealWith(createTestArtifactSealer());
    const composition = createCliWorkspaceComposition({
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      cwd,
      userHome: home,
      projectAccess: access,
      platform: 'darwin',
    });

    expect(composition.sessionStoreScope).toBe('user');
    composition.sessionStore.save(record('sess_a'));
    expect(
      readFileSync(join(userSessionsDirectory(home), 'sess_a.json')).includes(Buffer.from(CANARY)),
    ).toBe(false);
  });

  it("gives a command's own store the same answer as the composition's", () => {
    const home = tempRoot('composition-seal-home-');
    const artifactSealer = createTestArtifactSealer();
    sealWith(artifactSealer);
    const store = createProductUserSessionStore(
      createTestProductRuntime('test-product', { HOME: home }),
    );

    store.save(record('sess_a'));

    expect(
      readFileSync(join(userSessionsDirectory(home), 'sess_a.json')).includes(Buffer.from(CANARY)),
    ).toBe(false);
  });
});

describe('the project session store reached through the composition', () => {
  /** A sealed record already in the project's sessions directory, as an earlier secure run left it. */
  function seedSealedProjectSession(
    cwd: string,
    sealer: ReturnType<typeof createTestArtifactSealer>,
  ) {
    const directory = join(cwd, STATE.sessions);
    mkdirSync(directory, { recursive: true });
    const json = JSON.stringify({ schemaVersion: 2, record: record('sess_a') }, null, 2);
    writeFileSync(
      join(directory, 'sess_a.json'),
      sealer.sealBytes(Buffer.from(json), { kind: 'session-record', id: 'sess_a' }),
    );
  }

  it('opens a sealed record only when the resolver answers with the sealer', async () => {
    const home = tempRoot('composition-seal-home-');
    const cwd = tempRoot('composition-seal-cwd-');
    const access = await trustedAccess(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted access.');
    const artifactSealer = createTestArtifactSealer();
    seedSealedProjectSession(cwd, artifactSealer);
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const options = {
      productRuntime: runtime,
      cwd,
      userHome: home,
      projectAccess: access,
    } as const;

    const unsealed = createCliWorkspaceComposition({ ...options, platform: 'linux' });
    sealWith(artifactSealer);
    const sealed = createCliWorkspaceComposition({ ...options, platform: 'linux' });

    expect(unsealed.sessionStoreScope).toBe('project');
    expect(unsealed.sessionStore.load('sess_a')).toEqual({ status: 'locked', reason: 'no-keys' });
    // Sealed by hand with no authorship tag.
    expect(sealed.sessionStore.load('sess_a')).toEqual({
      status: 'valid',
      record: record('sess_a'),
      authorship: 'unverified',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it.runIf(process.platform === 'linux')('writes the project record sealed', async () => {
    const home = tempRoot('composition-seal-home-');
    const cwd = tempRoot('composition-seal-cwd-');
    const access = await trustedAccess(cwd);
    if (access.status !== 'trusted') throw new Error('Expected trusted access.');
    sealWith(createTestArtifactSealer());
    const composition = createCliWorkspaceComposition({
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      cwd,
      userHome: home,
      projectAccess: access,
    });

    composition.sessionStore.save(record('sess_b'));

    // Records are the `.json` files; the writer markers live beside them in `claims/`.
    const files = readdirSync(join(cwd, STATE.sessions)).filter((name) => name.endsWith('.json'));
    expect(files).toEqual(['sess_b.json']);
    expect(
      readFileSync(join(cwd, STATE.sessions, 'sess_b.json')).includes(Buffer.from(CANARY)),
    ).toBe(false);
  });
});

describe('the composition cli-core builds at startup', () => {
  it('asks the same resolver', () => {
    const home = tempRoot('composition-seal-home-');
    const cwd = tempRoot('composition-seal-cwd-');
    sealWith(createTestArtifactSealer());
    const composition = createInitialCliWorkspaceComposition(cwd, {
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    });

    composition.sessionStore.save(record('sess_a'));
    expect(
      readFileSync(join(userSessionsDirectory(home), 'sess_a.json')).includes(Buffer.from(CANARY)),
    ).toBe(false);
  });
});
