/**
 * The neutral half of addressing a project state directory by path: it hands out the trusted root as
 * text and the segments down to the directory, and touches no file. The walk that proves the path stays
 * inside the project is the Node adapter's (`node-project-state-directory.test.ts`).
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceProjectStateDirectoryParts } from './project-state-storage.js';
import { createTrustedProjectStateFixture } from '../testing/trusted-project-state-fixture.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, lstatSync: vi.fn(actual.lstatSync) };
});

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'project-state-directory-parts-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('workspaceProjectStateDirectoryParts', () => {
  it('returns the trusted root and the relative directory without reading the file system', async () => {
    const storage = await createTrustedProjectStateFixture(root, 'sessions');
    vi.mocked(nodeFs.lstatSync).mockClear();

    const parts = workspaceProjectStateDirectoryParts(storage, 'claims');

    expect(parts).toEqual({ worktreeRoot: root, segments: ['.agent', 'sessions', 'claims'] });
    expect(nodeFs.lstatSync).not.toHaveBeenCalled();
  });

  it('hands out a root string and segment strings, nothing that acts on a root', async () => {
    const storage = await createTrustedProjectStateFixture(root, 'sessions');
    const parts = workspaceProjectStateDirectoryParts(storage, 'claims');

    expect(Object.keys(parts).sort()).toEqual(['segments', 'worktreeRoot']);
    expect(typeof parts.worktreeRoot).toBe('string');
    expect(parts.segments.every((segment) => typeof segment === 'string')).toBe(true);
    expect(Object.isFrozen(parts)).toBe(true);
    expect(Object.isFrozen(parts.segments)).toBe(true);
  });

  it('keeps the refusal of a path that leaves the storage', async () => {
    const storage = await createTrustedProjectStateFixture(root, 'sessions');

    expect(() => workspaceProjectStateDirectoryParts(storage, join('..', 'elsewhere'))).toThrow();
  });
});
