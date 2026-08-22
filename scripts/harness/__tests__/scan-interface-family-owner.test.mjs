import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findCycles,
  findContractModules,
  migrationWaves,
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

function realSources() {
  return Object.fromEntries(
    realModules().map((m) => [m, readFileSync(path.join(SRC_DIR, `${m}.ts`), 'utf8')]),
  );
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
