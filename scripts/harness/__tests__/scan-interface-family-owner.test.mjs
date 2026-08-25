import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { judgeEdge, readInterfaceLayers } from '../interface-layers.mjs';

import {
  findCycles,
  resolveModuleSources,
  findLayerViolations,
  findContractModules,
  migrationWaves,
  manifestEdges,
  manifestEdgesMissingFromProjection,
  parseOwnerMap,
  projectGraph,
  readExaminedModuleCount,
} from '../scan-interface-family-owner.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const RULE_DOC = path.join(ROOT, '.agents/specs/contract-family-owner-map.md');
const SRC_DIR = path.join(ROOT, 'packages/agent-interface-transport/src');

/** The correction issue #2109 must apply; the real graph is acyclic only with it. */
const PENDING = [
  {
    from: 'workspace-contracts',
    to: 'session-contracts',
    symbol: 'IBackgroundJobGroupState',
    redirect: 'background-group-contracts',
  },
];

function realModules() {
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, ''));
}

/**
 * The real module sources, resolved through the SCAN's own resolver rather than a fixed directory.
 *
 * This helper used to read `agent-interface-transport/src` directly, and it decayed exactly as the
 * scan it tests did: each migration leaf moved modules out, the helper read fewer of them, and the
 * assertions it feeds got weaker without failing. Same defect as issue #2215, inside the test for the
 * scan that issue is about.
 */
function realSources() {
  const parsed = parseOwnerMap(readFileSync(RULE_DOC, 'utf8'));
  return resolveModuleSources(parsed.moduleOwner).sources;
}

/** A minimal owner-map document: the marker plus a table. */
function docOf(rows) {
  return [
    'preamble that must be ignored',
    '<!-- arch-100:owner-map -->',
    '| Target owner | Contract modules | Leaf |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

describe('parseOwnerMap (ARCH-100)', () => {
  it('reads one owner per contract module', () => {
    const { moduleOwner, owners } = parseOwnerMap(
      docOf([
        '| `agent-interface-command` | `command-contracts`, `capability-contracts` | issue #2108 |',
        '| `agent-interface-session` | `session-contracts` | issue #2110 |',
      ]),
    );
    expect(moduleOwner.get('command-contracts')).toBe('agent-interface-command');
    expect(moduleOwner.get('capability-contracts')).toBe('agent-interface-command');
    expect(moduleOwner.get('session-contracts')).toBe('agent-interface-session');
    expect([...owners].sort()).toEqual(['agent-interface-command', 'agent-interface-session']);
  });

  it('reports a module assigned to two owners rather than silently keeping the last', () => {
    const { duplicates } = parseOwnerMap(
      docOf([
        '| `agent-interface-command` | `command-contracts` | issue #2108 |',
        '| `agent-interface-session` | `command-contracts` | issue #2110 |',
      ]),
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatch(/assigned to more than one owner/);
  });

  it('reads a symbol-level owner from a `symbols@<module>:` cell', () => {
    const { symbolOwner, moduleOwner } = parseOwnerMap(
      docOf([
        '| `agent-interface-analytics` | symbols@`session-contracts`: `IUsageSnapshot`, `ISpanEntry` | issue #2112 |',
      ]),
    );
    expect(symbolOwner.get('IUsageSnapshot')).toBe('agent-interface-analytics');
    expect(symbolOwner.get('ISpanEntry')).toBe('agent-interface-analytics');
    // the module itself is NOT claimed by the analytics row — only those symbols are
    expect(moduleOwner.has('session-contracts')).toBe(false);
  });

  it('stops at the end of the table, so a later example row is not absorbed as a real assignment', () => {
    const doc = [
      '<!-- arch-100:owner-map -->',
      '| Target owner | Contract modules | Leaf |',
      '| --- | --- | --- |',
      '| `agent-interface-command` | `command-contracts` | issue #2108 |',
      '',
      'Prose explaining the format. A row below is an EXAMPLE, not an assignment:',
      '',
      '| `agent-interface-example` | `made-up-contracts` | issue #9999 |',
      '',
    ].join('\n');
    const { moduleOwner, owners } = parseOwnerMap(doc);
    expect(moduleOwner.has('command-contracts')).toBe(true);
    expect(moduleOwner.has('made-up-contracts')).toBe(false);
    expect([...owners]).toEqual(['agent-interface-command']);
  });

  it('signals a missing marker instead of returning an empty map that would read as a pass', () => {
    expect(parseOwnerMap('# a document with no owner map').missingMarker).toBe(true);
  });
});

describe('projectGraph + findCycles (ARCH-100)', () => {
  const moduleOwner = new Map([
    ['a-contracts', 'owner-a'],
    ['b-contracts', 'owner-b'],
  ]);

  it('projects a cross-owner import into a package edge', () => {
    const edges = projectGraph(
      { 'a-contracts': "import type { IThing } from './b-contracts.js';", 'b-contracts': '' },
      moduleOwner,
      new Map(),
    );
    expect([...edges.get('owner-a').keys()]).toEqual(['owner-b']);
  });

  it('ignores an import that stays inside one owner', () => {
    const sameOwner = new Map([
      ['a-contracts', 'owner-a'],
      ['b-contracts', 'owner-a'],
    ]);
    const edges = projectGraph(
      { 'a-contracts': "import type { IThing } from './b-contracts.js';", 'b-contracts': '' },
      sameOwner,
      new Map(),
    );
    expect(edges.size).toBe(0);
  });

  it('detects a two-owner cycle', () => {
    const edges = projectGraph(
      {
        'a-contracts': "import type { IThing } from './b-contracts.js';",
        'b-contracts': "import type { IOther } from './a-contracts.js';",
      },
      moduleOwner,
      new Map(),
    );
    const cycles = findCycles(edges, new Set(['owner-a', 'owner-b']));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain('owner-a');
    expect(cycles[0]).toContain('owner-b');
  });

  // MUST finding on PR #2176. The import parser matched only `from './x.js'`. Five extension-less
  // relative imports exist in the very package this scan polices, and every one was dropped from the
  // graph silently. Today's ACYCLICITY verdict survives only because each of those pairs happens to
  // ALSO have a `.js` import to the same owner -- a coincidence, not a property.
  //
  // Each case below is written so the VERDICT FLIPS: the extension-less (or re-export) edge is the
  // ONLY link between the two owners, so a parser that cannot see it reports zero cycles on a graph
  // that has one. A fixture that merely CONTAINS such an import would pass either way and would
  // re-create the same unfalsifiable green one layer down.
  const twoOwners = new Map([
    ['a-contracts', 'owner-a'],
    ['b-contracts', 'owner-b'],
  ]);

  it('sees an extension-less relative import as an edge', () => {
    const edges = projectGraph(
      { 'a-contracts': "import type { IThing } from './b-contracts';", 'b-contracts': '' },
      twoOwners,
      new Map(),
    );
    expect([...(edges.get('owner-a')?.keys() ?? [])]).toEqual(['owner-b']);
  });

  it('detects a cycle whose ONLY closing edge is extension-less', () => {
    const edges = projectGraph(
      {
        'a-contracts': "import type { IThing } from './b-contracts.js';",
        // no `.js` twin: if this line is invisible, the cycle is invisible
        'b-contracts': "import type { IOther } from './a-contracts';",
      },
      twoOwners,
      new Map(),
    );
    expect(findCycles(edges, new Set(['owner-a', 'owner-b']))).toHaveLength(1);
  });

  it('sees a `.ts`-suffixed relative import as an edge', () => {
    const edges = projectGraph(
      { 'a-contracts': "import type { IThing } from './b-contracts.ts';", 'b-contracts': '' },
      twoOwners,
      new Map(),
    );
    expect([...(edges.get('owner-a')?.keys() ?? [])]).toEqual(['owner-b']);
  });

  it('detects a cycle whose ONLY closing edge is a re-export rather than an import', () => {
    const edges = projectGraph(
      {
        'a-contracts': "import type { IThing } from './b-contracts.js';",
        // a re-export is a real dependency edge; the original parser only matched `import`
        'b-contracts': "export type { IOther } from './a-contracts.js';",
      },
      twoOwners,
      new Map(),
    );
    expect(findCycles(edges, new Set(['owner-a', 'owner-b']))).toHaveLength(1);
  });

  it('sees a value re-export (`export { x } from`) as an edge', () => {
    const edges = projectGraph(
      { 'a-contracts': "export { isThing } from './b-contracts.js';", 'b-contracts': '' },
      twoOwners,
      new Map(),
    );
    expect([...(edges.get('owner-a')?.keys() ?? [])]).toEqual(['owner-b']);
  });

  it('detects a cycle whose ONLY closing edge is a star re-export', () => {
    const edges = projectGraph(
      {
        'a-contracts': "import type { IThing } from './b-contracts.js';",
        // braceless: the brace-requiring pattern could not see this form at all
        'b-contracts': "export * from './a-contracts.js';",
      },
      twoOwners,
      new Map(),
    );
    expect(findCycles(edges, new Set(['owner-a', 'owner-b']))).toHaveLength(1);
  });

  it('sees a namespace import (`import * as ns from`) as an edge', () => {
    const edges = projectGraph(
      { 'a-contracts': "import * as b from './b-contracts.js';", 'b-contracts': '' },
      twoOwners,
      new Map(),
    );
    expect([...(edges.get('owner-a')?.keys() ?? [])]).toEqual(['owner-b']);
  });

  it('a pending correction redirects the edge and can break a cycle', () => {
    const owner = new Map([
      ['workspace-contracts', 'owner-exec'],
      ['session-contracts', 'owner-session'],
      ['background-group-contracts', 'owner-exec'],
    ]);
    const sources = {
      'workspace-contracts':
        "import type { IBackgroundJobGroupState } from './session-contracts.js';",
      'session-contracts':
        "import type { IExecutionWorkspaceEvent } from './workspace-contracts.js';",
      'background-group-contracts': '',
    };
    const before = findCycles(projectGraph(sources, owner, new Map()), new Set(owner.values()));
    expect(before).toHaveLength(1);

    const after = findCycles(
      projectGraph(sources, owner, new Map(), [
        {
          from: 'workspace-contracts',
          to: 'session-contracts',
          symbol: 'IBackgroundJobGroupState',
          redirect: 'background-group-contracts',
        },
      ]),
      new Set(owner.values()),
    );
    expect(after).toHaveLength(0);
  });

  it('a symbol-level owner re-homes the edge away from its declaring module', () => {
    const owner = new Map([
      ['turn-contracts', 'owner-session'],
      ['session-contracts', 'owner-session'],
    ]);
    const edges = projectGraph(
      {
        'turn-contracts': "import type { IUsageSnapshot } from './session-contracts.js';",
        'session-contracts': '',
      },
      owner,
      new Map([['IUsageSnapshot', 'owner-analytics']]),
    );
    expect([...edges.get('owner-session').keys()]).toEqual(['owner-analytics']);
  });
});

describe('projectGraph sees CROSS-PACKAGE edges, not only relative ones (ARCH-105)', () => {
  // The regression this fixes: a module's cross-family import is relative only while both families
  // share a package. Once a leaf moves one out, the same dependency is written as
  // `@robota-sdk/agent-interface-<owner>`. A relative-only parser stops seeing it, so the projected
  // graph EMPTIES as the migration succeeds — and fewer edges make acyclicity easier to satisfy, so
  // the verdict gets cheaper exactly as the work progresses. Measured on ARCH-105: session's edges
  // into execution, command and analytics had all become package specifiers and session moved into
  // wave 1 as though it depended on nothing.
  const owner = new Map([['a-contracts', 'agent-interface-session']]);
  const targets = (edges) => [...(edges.get('agent-interface-session')?.keys() ?? [])];

  it('sees a named package import as an edge to that owner', () => {
    expect(
      targets(
        projectGraph(
          { 'a-contracts': "import type { IThing } from '@robota-sdk/agent-interface-execution';" },
          owner,
          new Map(),
        ),
      ),
    ).toEqual(['agent-interface-execution']);
  });

  it('sees a package RE-EXPORT as an edge', () => {
    expect(
      targets(
        projectGraph(
          { 'a-contracts': "export type { IThing } from '@robota-sdk/agent-interface-command';" },
          owner,
          new Map(),
        ),
      ),
    ).toEqual(['agent-interface-command']);
  });

  it('sees a braceless package re-export as an edge', () => {
    expect(
      targets(
        projectGraph(
          { 'a-contracts': "export * from '@robota-sdk/agent-interface-analytics';" },
          owner,
          new Map(),
        ),
      ),
    ).toEqual(['agent-interface-analytics']);
  });

  it('ignores a package outside the agent-interface family', () => {
    expect(
      projectGraph(
        { 'a-contracts': "import type { IThing } from '@robota-sdk/agent-core';" },
        owner,
        new Map(),
      ).size,
    ).toBe(0);
  });

  it('detects a cycle whose ONLY closing edge is a package import', () => {
    const two = new Map([
      ['a-contracts', 'agent-interface-session'],
      ['b-contracts', 'agent-interface-execution'],
    ]);
    const edges = projectGraph(
      {
        'a-contracts': "import type { IThing } from '@robota-sdk/agent-interface-execution';",
        'b-contracts': "import type { IOther } from '@robota-sdk/agent-interface-session';",
      },
      two,
      new Map(),
    );
    expect(findCycles(edges, new Set(two.values()))).toHaveLength(1);
  });
});

describe('migrationWaves (ARCH-100)', () => {
  it('extracts owners with no outbound edge first', () => {
    const edges = new Map([
      ['owner-session', new Map([['owner-command', new Set(['x'])]])],
      ['owner-mobility', new Map([['owner-session', new Set(['y'])]])],
    ]);
    const waves = migrationWaves(
      edges,
      new Set(['owner-session', 'owner-command', 'owner-mobility']),
    );
    expect(waves[0]).toEqual(['owner-command']);
    expect(waves[1]).toEqual(['owner-session']);
    expect(waves[2]).toEqual(['owner-mobility']);
  });
});

describe('the real owner map in .agents/specs/contract-family-owner-map.md (ARCH-100 · issue #2080)', () => {
  const parsed = parseOwnerMap(readFileSync(RULE_DOC, 'utf8'));

  it('is present and parses to a non-empty map', () => {
    expect(parsed.missingMarker).toBe(false);
    expect(parsed.moduleOwner.size).toBeGreaterThan(0);
    expect(parsed.duplicates).toEqual([]);
  });

  it('assigns every contract module of agent-interface-transport exactly once', () => {
    const modules = realModules();
    for (const mod of modules) {
      expect(parsed.moduleOwner.get(mod), `\`${mod}\` has no owner in the map`).toBeDefined();
    }
  });

  it('yields an acyclic package graph — the precondition every migration leaf depends on', () => {
    const sources = realSources();
    const edges = projectGraph(sources, parsed.moduleOwner, parsed.symbolOwner, PENDING);
    expect(findCycles(edges, parsed.owners)).toEqual([]);
  });

  it('orders issue #2110 (session) after the three leaves it depends on', () => {
    const sources = realSources();
    const edges = projectGraph(sources, parsed.moduleOwner, parsed.symbolOwner, PENDING);
    const waves = migrationWaves(edges, parsed.owners);
    const waveOf = (owner) => waves.findIndex((w) => w.includes(owner));
    expect(waveOf('agent-interface-session')).toBeGreaterThan(waveOf('agent-interface-command'));
    expect(waveOf('agent-interface-session')).toBeGreaterThan(waveOf('agent-interface-execution'));
    expect(waveOf('agent-interface-session')).toBeGreaterThan(waveOf('agent-interface-analytics'));
    expect(waveOf('agent-interface-session-mobility')).toBeGreaterThan(
      waveOf('agent-interface-session'),
    );
  });
});

describe('readExaminedModuleCount — the size this scan reports (measurement-provenance.md)', () => {
  it('counts a fixture of known size exactly, and does not accumulate across runs', () => {
    const dir = makeTemp('arch-100-examined-');
    // 3 contract modules + an index.ts that is deliberately NOT a contract module.
    writeFileSync(path.join(dir, 'alpha-contracts.ts'), 'export type A = 1;');
    writeFileSync(path.join(dir, 'beta-contracts.ts'), 'export type B = 2;');
    writeFileSync(path.join(dir, 'gamma-contracts.ts'), 'export type C = 3;');
    writeFileSync(path.join(dir, 'index.ts'), "export type { A } from './alpha-contracts.js';");
    writeFileSync(path.join(dir, 'notes.md'), 'not a module');

    findContractModules(dir);
    expect(readExaminedModuleCount(dir)).toBe(3);
    // run the finder a SECOND time: an accumulating counter would report 6 here, a correct one 3
    findContractModules(dir);
    expect(readExaminedModuleCount(dir)).toBe(3);
  });

  it('reports zero for a directory holding only a barrel', () => {
    const dir = makeTemp('arch-100-examined-empty-');
    writeFileSync(path.join(dir, 'index.ts'), 'export {};');
    expect(readExaminedModuleCount(dir)).toBe(0);
  });

  it('the count it reports is the set it actually checks', () => {
    expect(readExaminedModuleCount()).toBe(findContractModules().length);
  });
});

describe('LAYER — acyclicity does not imply legality (ARCH-101 · issue #2180)', () => {
  // The reason the layer condition had to ship in the SAME change that relaxed the manifest
  // prohibition: a same-layer edge is perfectly acyclic, so `findCycles` reports nothing and the case
  // the ruling exists to forbid would be reachable and unguarded.
  const twoOwners = new Map([
    ['a-contracts', 'agent-interface-command'],
    ['b-contracts', 'agent-interface-execution'],
  ]);
  const sameLayer = new Map([
    ['agent-interface-command', 0],
    ['agent-interface-execution', 0],
  ]);

  const edges = projectGraph(
    { 'a-contracts': "import type { IThing } from './b-contracts.js';", 'b-contracts': '' },
    twoOwners,
    new Map(),
  );

  it('the same-layer graph is ACYCLIC — findCycles reports nothing', () => {
    expect(findCycles(edges, new Set(twoOwners.values()))).toEqual([]);
  });

  it('and it is still ILLEGAL — the layer check refuses what acyclicity permits', () => {
    const verdict = judgeEdge('agent-interface-command', 'agent-interface-execution', sameLayer);
    expect(verdict.legal).toBe(false);
    expect(verdict.reason).toBe('same-layer');
  });

  it('the real module graph is legal under the real declaration', () => {
    const parsed = parseOwnerMap(readFileSync(RULE_DOC, 'utf8'));
    const realEdges = projectGraph(realSources(), parsed.moduleOwner, parsed.symbolOwner, PENDING);
    const layers = readInterfaceLayers();
    const illegal = [];
    for (const [from, outs] of realEdges) {
      for (const to of outs.keys()) {
        if (!judgeEdge(from, to, layers).legal) illegal.push(`${from} → ${to}`);
      }
    }
    expect(illegal).toEqual([]);
  });
});

describe("findLayerViolations — the SCAN's use of the layer predicate, not the predicate alone", () => {
  // regression-red-proof reported `accidental-green-fail (all-pass)` when this condition lived inline
  // in main(): the suite tested judgeEdge directly and never that the scan consulted it, so reversing
  // the scan's fix left every test green. These cases fail if the condition is removed.
  const layers = new Map([
    ['agent-interface-command', 0],
    ['agent-interface-execution', 0],
    ['agent-interface-session', 1],
  ]);
  const edgesOf = (from, to) => new Map([[from, new Map([[to, new Set(['ISomeType (a → b)'])]])]]);

  it('returns nothing for a legal downward edge', () => {
    expect(
      findLayerViolations(edgesOf('agent-interface-session', 'agent-interface-execution'), layers),
    ).toEqual([]);
  });

  it('reports a same-layer edge', () => {
    const out = findLayerViolations(
      edgesOf('agent-interface-command', 'agent-interface-execution'),
      layers,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('LAYER:');
    expect(out[0]).toContain('SAME-LAYER');
  });

  it('reports an upward edge', () => {
    const out = findLayerViolations(
      edgesOf('agent-interface-execution', 'agent-interface-session'),
      layers,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('UPWARD');
  });

  it('names the symbols that carry an illegal edge, so it can be acted on', () => {
    const out = findLayerViolations(
      edgesOf('agent-interface-command', 'agent-interface-execution'),
      layers,
    );
    expect(out[0]).toContain('ISomeType');
  });

  it('reports an undeclared owner rather than passing it', () => {
    const out = findLayerViolations(
      edgesOf('agent-interface-session', 'agent-interface-unlisted'),
      layers,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('no declared layer');
  });
});

describe('manifest edges as an independent oracle for the projection (issue #2215)', () => {
  /** The projection over the real tree, which every case below compares against. */
  function projectedNow() {
    const map = parseOwnerMap(readFileSync(RULE_DOC, 'utf8'));
    const { sources } = resolveModuleSources(map.moduleOwner);
    return projectGraph(sources, map.moduleOwner, map.symbolOwner, map.corrections ?? []);
  }

  it('reads the edges the package manifests declare between interface packages', () => {
    const edges = manifestEdges();
    // Non-empty is the control: an oracle that reads nothing agrees with every projection, which is
    // the unfalsifiable green this whole scan exists to refuse.
    expect(edges.size).toBeGreaterThan(0);
    for (const edge of edges) expect(edge).toMatch(/^agent-interface-\S+ -> agent-interface-\S+$/);
  });

  it('every manifest edge is carried by the projection today', () => {
    expect(manifestEdgesMissingFromProjection(projectedNow(), manifestEdges())).toEqual([]);
  });

  it('CATCHES the historical defect: a projection blind to package specifiers', () => {
    // The measured failure this oracle exists for. `session-contracts`' edges into execution,
    // command and analytics became package specifiers as leaves moved out; a relative-only parser
    // lost all three, `session` appeared to depend on nothing, and ACYCLICITY STAYED GREEN — fewer
    // edges make it easier to satisfy. Simulated here by projecting with the package-specifier
    // matches removed from the sources, which is what a relative-only parser would have seen.
    const map = parseOwnerMap(readFileSync(RULE_DOC, 'utf8'));
    const { sources } = resolveModuleSources(map.moduleOwner);
    const relativeOnly = Object.fromEntries(
      Object.entries(sources).map(([mod, src]) => [
        mod,
        src.replace(/@robota-sdk\/agent-interface-[a-z-]+/g, './REDACTED'),
      ]),
    );
    const blind = projectGraph(
      relativeOnly,
      map.moduleOwner,
      map.symbolOwner,
      map.corrections ?? [],
    );
    const missed = manifestEdgesMissingFromProjection(blind, manifestEdges());
    expect(missed.length).toBeGreaterThan(0);
    // And the point: the blind projection is still ACYCLIC. The old verdict would have passed.
    expect(findCycles(blind, new Set(map.moduleOwner.values()))).toEqual([]);
  });

  it('does not fault a projected edge the manifests do not declare', () => {
    // The reverse direction is a MISSING DEPENDENCY DECLARATION — a different defect with a
    // different owner. Checking it here would make one finding stand for two.
    const projected = new Map([['agent-interface-a', new Map([['agent-interface-b', new Set()]])]]);
    expect(manifestEdgesMissingFromProjection(projected, new Set())).toEqual([]);
  });
});
