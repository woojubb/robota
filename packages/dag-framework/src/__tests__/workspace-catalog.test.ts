/**
 * FLOW-007 C3 — shared workspace-catalog reader. Real fs, no mocks.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IWorkspaceLayout } from '@robota-sdk/dag-core';
import { scanWorkspaceCatalog } from '../workspace-catalog.js';

const DAG = { dagId: 'x', version: 1, status: 'draft', nodes: [{ nodeId: 'a' }], edges: [] };

describe('scanWorkspaceCatalog (FLOW-007 C3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ws-catalog-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] for a missing directory', async () => {
    expect(await scanWorkspaceCatalog(join(dir, 'nope'))).toEqual([]);
  });

  it('lists flat .json workflows; skips node manifests, non-DAG JSON, and other files', async () => {
    mkdirSync(join(dir, 'nodes'), { recursive: true });
    writeFileSync(join(dir, 'greet.json'), JSON.stringify({ ...DAG, meta: { tags: ['hi'] } }));
    writeFileSync(join(dir, 'summarize.json'), JSON.stringify(DAG));
    writeFileSync(join(dir, 'aliases.json'), JSON.stringify({ a: 1 })); // aux, not a DAG
    writeFileSync(join(dir, 'greet.node.json'), JSON.stringify({ kind: 'code' })); // node manifest
    writeFileSync(join(dir, 'notes.txt'), 'x');
    writeFileSync(join(dir, 'broken.json'), '{ not json');

    const entries = await scanWorkspaceCatalog(dir);
    expect(entries.map((e) => e.id)).toEqual(['greet', 'summarize']); // sorted, aux/manifest/etc. skipped
    expect(entries[0].meta.tags).toEqual(['hi']);
    expect(entries[0].filePath).toBe(join(dir, 'greet.json'));
  });

  it('honors a custom injected layout (root + workflow extension)', async () => {
    const layout: IWorkspaceLayout = { root: '.custom', workflowExt: '.flow.json' };
    writeFileSync(join(dir, 'a.flow.json'), JSON.stringify(DAG));
    writeFileSync(join(dir, 'b.json'), JSON.stringify(DAG)); // wrong ext for this layout
    const entries = await scanWorkspaceCatalog(dir, layout);
    expect(entries.map((e) => e.id)).toEqual(['a']);
  });
});
