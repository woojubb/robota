import { describe, it, expect } from 'vitest';
import { buildFlowLayout, renderFlowLayout } from '../renderer/flow-lines.js';
import type { IDagDefinition } from '@robota-sdk/dag-core';

const makeNode = (nodeId: string, dependsOn: string[]) => ({
  nodeId,
  nodeType: 'test',
  dependsOn,
  config: {},
});

describe('buildFlowLayout', () => {
  it('linear chain produces single groups (no root group for chained nodes)', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('A', []), makeNode('B', ['A']), makeNode('C', ['B'])],
      edges: [
        { from: 'A', to: 'B', bindings: [] },
        { from: 'B', to: 'C', bindings: [] },
      ],
    };

    const layout = buildFlowLayout(dag);
    // A→B→C: 2 single groups (root only for truly isolated nodes with no edges)
    expect(layout.groups).toHaveLength(2);
    expect(layout.groups[0]).toMatchObject({ kind: 'single', from: 'A', to: 'B' });
    expect(layout.groups[1]).toMatchObject({ kind: 'single', from: 'B', to: 'C' });
  });

  it('isolated node (no edges) produces root group', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('solo', [])],
      edges: [],
    };
    const layout = buildFlowLayout(dag);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]).toMatchObject({ kind: 'root', nodeId: 'solo' });
  });

  it('fan-out (1→N) produces fanout group', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('src', []), makeNode('A', ['src']), makeNode('B', ['src'])],
      edges: [
        { from: 'src', to: 'A', bindings: [] },
        { from: 'src', to: 'B', bindings: [] },
      ],
    };

    const layout = buildFlowLayout(dag);
    const fanout = layout.groups.find((g) => g.kind === 'fanout');
    expect(fanout).toBeDefined();
    expect(fanout).toMatchObject({
      kind: 'fanout',
      from: 'src',
      targets: expect.arrayContaining(['A', 'B']),
    });
  });

  it('fan-in (N→1) produces fanin group', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('A', []), makeNode('B', []), makeNode('merge', ['A', 'B'])],
      edges: [
        { from: 'A', to: 'merge', bindings: [] },
        { from: 'B', to: 'merge', bindings: [] },
      ],
    };

    const layout = buildFlowLayout(dag);
    const fanin = layout.groups.find((g) => g.kind === 'fanin');
    expect(fanin).toBeDefined();
    expect(fanin).toMatchObject({
      kind: 'fanin',
      to: 'merge',
      sources: expect.arrayContaining(['A', 'B']),
    });
  });
});

describe('renderFlowLayout', () => {
  it('renders linear chain correctly', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('A', []), makeNode('B', ['A'])],
      edges: [{ from: 'A', to: 'B', bindings: [] }],
    };
    const layout = buildFlowLayout(dag);
    const lines = renderFlowLayout(
      layout,
      new Map([
        ['A', 'done'],
        ['B', 'running'],
      ]),
    );
    expect(lines.some((l) => l.includes('✓') && l.includes('A'))).toBe(true);
    expect(lines.some((l) => l.includes('B'))).toBe(true);
    expect(lines.some((l) => l.includes('──▶'))).toBe(true);
  });

  it('renders fan-out with ┬/└ brackets', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('src', []), makeNode('A', ['src']), makeNode('B', ['src'])],
      edges: [
        { from: 'src', to: 'A', bindings: [] },
        { from: 'src', to: 'B', bindings: [] },
      ],
    };
    const layout = buildFlowLayout(dag);
    const lines = renderFlowLayout(layout, new Map());
    const combined = lines.join('\n');
    expect(combined).toContain('┬──▶');
    expect(combined).toContain('└──▶');
  });

  it('renders fan-in with ┐/┤/┴ brackets', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [
        makeNode('A', []),
        makeNode('B', []),
        makeNode('C', []),
        makeNode('merge', ['A', 'B', 'C']),
      ],
      edges: [
        { from: 'A', to: 'merge', bindings: [] },
        { from: 'B', to: 'merge', bindings: [] },
        { from: 'C', to: 'merge', bindings: [] },
      ],
    };
    const layout = buildFlowLayout(dag);
    const lines = renderFlowLayout(layout, new Map());
    const combined = lines.join('\n');
    expect(combined).toContain('──┐');
    expect(combined).toContain('──┤');
    expect(combined).toContain('──┴──▶');
  });

  it('renders pending as [ ], done as [✓], error as [✗]', () => {
    const dag: IDagDefinition = {
      dagId: 'test',
      version: 1,
      status: 'draft',
      nodes: [makeNode('A', []), makeNode('B', ['A']), makeNode('C', ['B'])],
      edges: [
        { from: 'A', to: 'B', bindings: [] },
        { from: 'B', to: 'C', bindings: [] },
      ],
    };
    const layout = buildFlowLayout(dag);
    const lines = renderFlowLayout(
      layout,
      new Map([
        ['A', 'done'],
        ['B', 'error'],
        ['C', 'pending'],
      ]),
    );
    const combined = lines.join('\n');
    expect(combined).toContain('[✓]');
    expect(combined).toContain('[✗]');
    expect(combined).toContain('[ ]');
  });
});

describe('view command integration (dag view behavior)', () => {
  it('multi-input-demo produces fan-out and fan-in in same layout', () => {
    const dag: IDagDefinition = {
      dagId: 'multi-input-fan-in-demo',
      version: 1,
      status: 'draft',
      nodes: [
        makeNode('inputs', []),
        makeNode('format-prompt', ['inputs']),
        makeNode('format-audience', ['inputs']),
        makeNode('llm', ['format-prompt']),
        makeNode('merge', ['llm', 'format-audience']),
        makeNode('output', ['merge']),
      ],
      edges: [
        { from: 'inputs', to: 'format-prompt', bindings: [] },
        { from: 'inputs', to: 'format-audience', bindings: [] },
        { from: 'format-prompt', to: 'llm', bindings: [] },
        { from: 'llm', to: 'merge', bindings: [] },
        { from: 'format-audience', to: 'merge', bindings: [] },
        { from: 'merge', to: 'output', bindings: [] },
      ],
    };
    const layout = buildFlowLayout(dag);
    const lines = renderFlowLayout(layout, new Map());
    const combined = lines.join('\n');

    // fan-out from inputs
    expect(combined).toContain('┬──▶');
    expect(combined).toContain('└──▶');
    // fan-in to merge
    expect(combined).toContain('──┐');
    expect(combined).toContain('──┴──▶');
    // all nodes present
    expect(combined).toContain('inputs');
    expect(combined).toContain('format-prompt');
    expect(combined).toContain('format-audience');
    expect(combined).toContain('llm');
    expect(combined).toContain('merge');
    expect(combined).toContain('output');
  });
});
