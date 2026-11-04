/**
 * Which projects `secure migrate` writes (#3679): the roots a state root remembers — trust grants,
 * session-record working directories, prompt-history projects — are only candidates; one is written
 * only when the trust service says it is trusted now, on a host that can write project state, and
 * every other root that holds project state is listed with why, and never written.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework/node';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { discoverProjectRoots, probeWithGit } from '../migration-roots.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

const CANARY = 'CANARY-e3c1-in-an-untrusted-project';
const posixOnly = process.platform === 'win32';

let home: string;
let runtime: ICliRuntimeContext;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'migration-roots-')));
  runtime = createTestProductRuntime('test-product', { HOME: home });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A git worktree at `name` under home, holding plain project state with the canary. */
function project(name: string): string {
  const root = join(home, name);
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  const sessions = join(root, runtime.layout.projectStateDirectories.sessions);
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'plain_one.json'), `{"note":"${CANARY}"}`);
  return root;
}

function recordIn(cwd: string): void {
  new NodeSessionStore(runtime.layout.userPaths.sessions, { sealing: 'plain' }).save({
    id: `session_${Math.random().toString(36).slice(2, 8)}`,
    cwd,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    messages: [],
  });
}

function historyIn(project: string): void {
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  writeFileSync(
    runtime.layout.userPaths.history,
    `${JSON.stringify({ at: '2026-11-01T00:00:00.000Z', sessionId: 's', project, text: 'hi' })}\n`,
  );
}

async function trust(root: string): Promise<void> {
  await createNodeWorkspaceTrustService(
    runtime.layout.userPaths.workspaceTrust,
    runtime.layout.projectStateDirectories,
  ).grant(root);
}

/** Runs `work` where no git can be found, as on a host where git cannot be started. */
async function withoutGit<T>(work: () => Promise<T>): Promise<T> {
  const path = process.env['PATH'];
  process.env['PATH'] = join(home, 'no-git-here');
  try {
    return await work();
  } finally {
    if (path === undefined) delete process.env['PATH'];
    else process.env['PATH'] = path;
  }
}

describe.skipIf(posixOnly)('discoverProjectRoots', () => {
  it('lists, and never writes, an untrusted root a session record or the history names', async () => {
    const fromRecord = project('from-record');
    const fromHistory = project('from-history');
    recordIn(fromRecord);
    historyIn(fromHistory);

    const roots = await discoverProjectRoots(runtime, createTestArtifactSealer());

    expect(roots.trusted).toEqual([]);
    expect(roots.listed).toEqual(
      expect.arrayContaining([
        { root: fromRecord, reason: { kind: 'not-trusted', trustState: 'untrusted' } },
        { root: fromHistory, reason: { kind: 'not-trusted', trustState: 'untrusted' } },
      ]),
    );
    for (const root of [fromRecord, fromHistory]) {
      expect(
        readFileSync(
          join(root, runtime.layout.projectStateDirectories.sessions, 'plain_one.json'),
          'utf8',
        ),
      ).toContain(CANARY);
    }
  });

  it('writes a trusted root only on a host that can write project state, and lists it elsewhere', async () => {
    const root = project('trusted');
    await trust(root);

    const onDarwin = await discoverProjectRoots(runtime, createTestArtifactSealer(), {
      platform: 'darwin',
    });
    expect(onDarwin.trusted).toEqual([]);
    expect(onDarwin.listed).toEqual([{ root, reason: { kind: 'host-cannot-write' } }]);

    const onLinux = await discoverProjectRoots(runtime, createTestArtifactSealer(), {
      platform: 'linux',
    });
    expect(onLinux.trusted.map((trusted) => trusted.root)).toEqual([root]);
    expect(onLinux.listed).toEqual([]);
  });

  it('lists project state an older build kept below the workspace root, and a state directory that is a link', async () => {
    const root = project('workspace');
    const below = join(root, 'packages', 'app');
    mkdirSync(join(below, runtime.layout.projectDirectory), { recursive: true });
    recordIn(below);
    const linked = join(home, 'linked');
    mkdirSync(linked);
    execFileSync('git', ['init', '-q', linked], { stdio: 'ignore' });
    symlinkSync(
      join(root, runtime.layout.projectDirectory),
      join(linked, runtime.layout.projectDirectory),
    );
    recordIn(linked);

    const roots = await discoverProjectRoots(runtime, createTestArtifactSealer());

    expect(roots.listed).toEqual(
      expect.arrayContaining([
        { root: below, reason: { kind: 'below-workspace-root' } },
        { root, reason: { kind: 'not-trusted', trustState: 'untrusted' } },
        { root: linked, reason: { kind: 'state-is-link' } },
      ]),
    );
  });

  it('counts recorded working directories that no longer exist, and skips roots with no project state', async () => {
    recordIn(join(home, 'gone'));
    const bare = join(home, 'bare');
    mkdirSync(bare);
    execFileSync('git', ['init', '-q', bare], { stdio: 'ignore' });
    recordIn(bare);

    const roots = await discoverProjectRoots(runtime, createTestArtifactSealer());

    expect(roots).toEqual({ trusted: [], listed: [], vanished: 1 });
  });

  it('lists as unreachable a root whose probe never answers, within the timeout, and goes on with the rest', async () => {
    const hung = project('on-a-dead-mount');
    const fine = project('reachable');
    recordIn(hung);
    recordIn(fine);
    const started = Date.now();

    const roots = await discoverProjectRoots(runtime, createTestArtifactSealer(), {
      statTimeoutMs: 200,
      probe: (candidate) => (candidate === hung ? new Promise(() => {}) : Promise.resolve()),
    });

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(roots.listed).toEqual(
      expect.arrayContaining([
        { root: hung, reason: { kind: 'unreachable' } },
        { root: fine, reason: { kind: 'not-trusted', trustState: 'untrusted' } },
      ]),
    );
    expect(roots.listed.filter((listed) => listed.root === hung)).toHaveLength(1);
  });

  it('probes several roots at a time, and never more than a few', async () => {
    for (let index = 0; index < 8; index += 1) {
      const root = join(home, `root-${index}`);
      mkdirSync(root);
      recordIn(root);
    }
    let probing = 0;
    let most = 0;

    await discoverProjectRoots(runtime, createTestArtifactSealer(), {
      probe: async () => {
        probing += 1;
        most = Math.max(most, probing);
        await new Promise((settle) => setTimeout(settle, 50));
        probing -= 1;
      },
    });

    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
  });

  it('says its default probe could not run when git cannot be started', async () => {
    await withoutGit(async () => {
      await expect(probeWithGit(home, new AbortController().signal)).rejects.toMatchObject({
        name: 'CandidateProbeUnavailableError',
      });
    });
  });

  it('when git cannot be started, looks at each root through a bounded look, and lists one that never answers as unreachable', async () => {
    const fine = project('reachable');
    const hung = project('on-a-dead-mount');
    recordIn(fine);
    historyIn(hung);
    const looked: string[] = [];

    const roots = await withoutGit(() =>
      discoverProjectRoots(runtime, createTestArtifactSealer(), {
        statTimeoutMs: 200,
        look: (candidate) => {
          looked.push(candidate);
          return candidate === hung ? new Promise(() => {}) : Promise.resolve();
        },
      }),
    );

    expect(looked).toEqual([fine, hung]);
    expect(roots.listed).toEqual([
      { root: fine, reason: expect.objectContaining({ kind: 'not-trusted' }) },
      { root: hung, reason: { kind: 'unreachable' } },
    ]);
  });

  it('when git cannot be started, risks no second look once one has not answered, since that one holds a pool thread', async () => {
    const first = project('first');
    const second = project('second');
    recordIn(first);
    historyIn(second);
    const looked: string[] = [];

    const roots = await withoutGit(() =>
      discoverProjectRoots(runtime, createTestArtifactSealer(), {
        statTimeoutMs: 200,
        look: (candidate) => {
          looked.push(candidate);
          return new Promise(() => {});
        },
      }),
    );

    expect(looked).toEqual([first]);
    expect(roots.listed).toEqual([
      { root: first, reason: { kind: 'unreachable' } },
      { root: second, reason: { kind: 'unreachable' } },
    ]);
  });

  it('answers through its default probe, a child process, for a root that is reachable', async () => {
    const root = project('probed');
    recordIn(root);

    const roots = await discoverProjectRoots(runtime, createTestArtifactSealer(), {
      statTimeoutMs: 10_000,
    });

    expect(roots.listed).toEqual([
      { root, reason: { kind: 'not-trusted', trustState: 'untrusted' } },
    ]);
  });

  it('reads the trust store as it is, never narrowing the mode an older build left', async () => {
    const root = project('trusted-readable');
    await trust(root);
    chmodSync(runtime.layout.userPaths.workspaceTrust, 0o644);

    await discoverProjectRoots(runtime, createTestArtifactSealer(), { platform: 'linux' });

    expect(statSync(runtime.layout.userPaths.workspaceTrust).mode & 0o777).toBe(0o644);
  });

  it('lists a trust store that cannot be read, and trusts nothing from it', async () => {
    mkdirSync(runtime.layout.userRoot, { recursive: true });
    writeFileSync(runtime.layout.userPaths.workspaceTrust, '{ not json');

    const roots = await discoverProjectRoots(runtime, createTestArtifactSealer());

    expect(roots.listed).toEqual([
      { root: runtime.layout.userPaths.workspaceTrust, reason: { kind: 'trust-store-unreadable' } },
    ]);
  });
});
