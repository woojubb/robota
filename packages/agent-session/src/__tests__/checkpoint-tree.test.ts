import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { CheckpointTree } from '../checkpoint-tree.js';

/**
 * SELFHOST-007 TC-01 / TC-02 — the neutral checkpoint tree.
 *
 * TC-01: fork / switch / listBranches / ancestors over {id,parentId} nodes; NO file/system I/O.
 * TC-02: forking from a past checkpoint preserves the parent line AND diverges (shared ancestor).
 */
describe('SELFHOST-007 TC-01 — checkpoint tree operations', () => {
  it('builds a linear chain and reports ancestors nearest-first to the root', () => {
    const tree = new CheckpointTree();
    tree.addCheckpoint('a');
    tree.addCheckpoint('b');
    tree.addCheckpoint('c');
    expect(tree.activeLeaf()).toBe('c');
    expect(tree.ancestors('c')).toEqual(['c', 'b', 'a']);
    expect(tree.listBranches()).toEqual(['c']); // single tip
  });

  it('switch moves the active head to an existing node', () => {
    const tree = new CheckpointTree();
    tree.addCheckpoint('a');
    tree.addCheckpoint('b');
    tree.switch('a');
    expect(tree.activeLeaf()).toBe('a');
  });

  it('rejects duplicate ids and unknown fork/switch targets', () => {
    const tree = new CheckpointTree();
    tree.addCheckpoint('a');
    expect(() => tree.addCheckpoint('a')).toThrow(/duplicate/);
    expect(() => tree.fork('nope')).toThrow(/unknown/);
    expect(() => tree.switch('nope')).toThrow(/unknown/);
  });

  it('has no file/system I/O imports in the module', () => {
    const src = readFileSync(new URL('../checkpoint-tree.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from ['"]node:fs['"]/);
    expect(src).not.toMatch(/from ['"]node:path['"]/);
    expect(src).not.toMatch(/require\(['"]fs['"]\)/);
  });
});

describe('SELFHOST-007 TC-02 — fork preserves the parent line and diverges', () => {
  it('keeps the original branch reachable after forking from a past checkpoint', () => {
    const tree = new CheckpointTree();
    tree.addCheckpoint('a');
    tree.addCheckpoint('b');
    tree.addCheckpoint('c'); // line a-b-c

    tree.fork('a'); // move head to a — the next append diverges from a
    tree.addCheckpoint('d'); // new branch a-d

    // both tips reachable
    expect(tree.listBranches().sort()).toEqual(['c', 'd']);
    // original line intact
    expect(tree.ancestors('c')).toEqual(['c', 'b', 'a']);
    // new branch diverges from the common ancestor 'a'
    expect(tree.ancestors('d')).toEqual(['d', 'a']);
    // the two branches share exactly the common ancestor 'a'
    const shared = tree.ancestors('c').filter((id) => tree.ancestors('d').includes(id));
    expect(shared).toEqual(['a']);
    expect(tree.activeLeaf()).toBe('d');
  });

  it('supports switching back to the original branch tip after a fork', () => {
    const tree = new CheckpointTree();
    tree.addCheckpoint('a');
    tree.addCheckpoint('b');
    tree.fork('a');
    tree.addCheckpoint('c'); // branch a-c
    tree.switch('b'); // back to the original tip
    expect(tree.activeLeaf()).toBe('b');
    tree.addCheckpoint('d'); // continues the original branch b-d
    expect(tree.ancestors('d')).toEqual(['d', 'b', 'a']);
  });

  it('fromNodes reconstructs a branched tree from explicit edges (persisted manifest delegation)', () => {
    // a-b-c and a divergent a-d, arriving out of order
    const tree = CheckpointTree.fromNodes(
      [
        { id: 'd', parentId: 'a' },
        { id: 'c', parentId: 'b' },
        { id: 'a' },
        { id: 'b', parentId: 'a' },
      ],
      'd',
    );
    expect(tree.listBranches().sort()).toEqual(['c', 'd']);
    expect(tree.ancestors('c')).toEqual(['c', 'b', 'a']);
    expect(tree.ancestors('d')).toEqual(['d', 'a']);
    expect(tree.activeLeaf()).toBe('d');
  });
});
