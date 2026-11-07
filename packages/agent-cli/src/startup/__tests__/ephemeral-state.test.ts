/**
 * The scratch directories a run keeps in the state root: the spill parent is made owner-only before a
 * store is built in it, and the next start removes what a process that died left behind — the one
 * thing no exit handler can do.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { readCurrentProcessIdentity } from '@robota-sdk/agent-core/node';
import { goneProcessOwner, leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import {
  EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX,
  prepareSpillParentDirectory,
  sweepStaleEphemeralState,
} from '../ephemeral-state.js';

const DEAD_PID = 2_147_000_000;
const roots: string[] = [];
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
});

afterEach(() => {
  process.umask(previousUmask);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runtimeWithState() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-ephemeral-state-')));
  roots.push(home);
  return createTestProductRuntime('test-product', { HOME: home });
}

/** A scratch directory holding conversation content, as `pid`'s run would have left it. */
function leave(parent: string, prefix: string, pid: number): string {
  const owner = pid === process.pid ? readCurrentProcessIdentity() : goneProcessOwner(pid);
  return leaveProcessScopedDirectory(parent, prefix, owner);
}

describe('prepareSpillParentDirectory', () => {
  it.skipIf(process.platform === 'win32')(
    'makes the spill parent inside the state root, owner-only, and tightens one an older run left wider',
    () => {
      const runtime = runtimeWithState();
      const spill = runtime.layout.userPaths.spill;
      mkdirSync(spill, { recursive: true, mode: 0o755 });

      expect(prepareSpillParentDirectory(runtime)).toBe(spill);

      expect(spill.startsWith(`${runtime.layout.userRoot}/`)).toBe(true);
      expect(statSync(spill).mode & 0o777).toBe(0o700);
    },
  );
});

describe('sweepStaleEphemeralState', () => {
  it('removes what dead processes left in every scratch parent, and keeps what a live one owns', () => {
    const runtime = runtimeWithState();
    const { spill, editor, ephemeralCheckpoints } = runtime.layout.userPaths;
    const editorPrefix = basename(runtime.vocabulary.editorTemporaryDirectoryPrefix);
    const stale = [
      leave(spill, 'agent-tool-results-', DEAD_PID),
      leave(editor, editorPrefix, DEAD_PID),
      leave(ephemeralCheckpoints, EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX, DEAD_PID),
    ];
    const live = [
      leave(spill, 'agent-tool-results-', process.pid),
      leave(editor, editorPrefix, process.pid),
      leave(ephemeralCheckpoints, EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX, process.pid),
    ];

    sweepStaleEphemeralState(runtime);

    for (const directory of stale) expect(existsSync(directory), directory).toBe(false);
    for (const directory of live) expect(existsSync(directory), directory).toBe(true);
  });

  it('starts cleanly in a state root that has none of them yet', () => {
    const runtime = runtimeWithState();

    expect(() => sweepStaleEphemeralState(runtime)).not.toThrow();
    // A sweep only removes; it never creates the state root for a run that has none.
    expect(existsSync(runtime.layout.userRoot)).toBe(false);
  });
});
