import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  collectToolClassification,
  declaredToolNames,
  examinedProducedToolCount,
  findUnclassifiedTools,
  producedToolNames,
} from '../scan-tool-classification.mjs';

/**
 * CORE-030 — the floor that couples produced tools to their permission classification.
 *
 * The item's Test Plan is explicit about the trap here: today's tree passes, so asserting only
 * "the tree is clean" would be a check that has never been shown capable of failing. Every case
 * below that matters is proved against a **fixture that introduces the divergence** — a produced
 * tool nobody classified — and the live-tree case is stated as what it is: a snapshot, meaningful
 * only because the fixtures show the mechanism works.
 */

/** A throwaway workspace holding exactly the tool-creation lines given. */
const fixtureRoots = [];
function makeFixtureRoot(lines) {
  const root = makeTemp('core-030-fixture-');
  fixtureRoots.push(root);
  const src = path.join(root, 'packages', 'fixture-pkg', 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(
    path.join(root, 'packages', 'fixture-pkg', 'package.json'),
    JSON.stringify({ name: 'fixture-pkg' }),
    'utf8',
  );
  writeFileSync(path.join(src, 'tools.ts'), lines.join('\n'), 'utf8');
  return root;
}

afterEach(() => {
  while (fixtureRoots.length > 0) {
    rmSync(fixtureRoots.pop(), { recursive: true, force: true });
  }
});

describe('CORE-030 — extracting the two sets', () => {
  it('finds a tool name from its creation call', () => {
    expect(producedToolNames("createZodFunctionTool('Read', desc, schema, fn)")).toEqual(['Read']);
    expect(producedToolNames("createZodFunctionTool(\n  'Grep',\n  desc,\n)")).toEqual(['Grep']);
  });

  it('finds declared names from a profiles record', () => {
    const source = [
      'export const AGENT_TOOL_PERMISSION_PROFILES = {',
      "  Read: { argumentKey: 'filePath', riskClass: 'inspect' },",
      "  Shell: { argumentKey: 'command', riskClass: 'execute' },",
      '};',
    ].join('\n');
    expect(declaredToolNames(source)).toEqual(['Read', 'Shell']);
  });

  it('does not read past the end of the record', () => {
    // A key in a LATER object literal is not a declaration; the brace matcher has to stop.
    const source = [
      'export const FRAMEWORK_TOOL_PERMISSION_PROFILES = {',
      "  Agent: { riskClass: 'execute' },",
      '};',
      'const somethingElse = {',
      '  NotATool: { irrelevant: true },',
      '};',
    ].join('\n');
    expect(declaredToolNames(source)).toEqual(['Agent']);
  });
});

describe('CORE-030 — the check fails on a divergence', () => {
  it('flags a produced tool that nobody classified', () => {
    // The fixture the item asks for: this is the state the old arrangement was actually in, with
    // `Agent`, `BackgroundProcess`, `CodebaseRetrieval` and `ExecuteCommand` all produced and
    // unknown to the permission matrix.
    const findings = findUnclassifiedTools(
      [
        { name: 'Read', file: 'packages/agent-tools/src/read-tool.ts' },
        { name: 'CodebaseRetrieval', file: 'packages/agent-tools/src/retrieval-tool.ts' },
      ],
      [{ name: 'Read', file: 'packages/agent-tools/src/tool-permission-profiles.ts' }],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].tool).toBe('CodebaseRetrieval');
    expect(findings[0].file).toBe('packages/agent-tools/src/retrieval-tool.ts');
    expect(findings[0].text).toMatch(/refused in plan mode/);
  });

  it('accepts a declaration made in a different package from the tool', () => {
    // The two live in the same package today, but the mechanism must not require it — a host may
    // classify a tool it supplies.
    expect(
      findUnclassifiedTools(
        [{ name: 'Agent', file: 'packages/agent-framework/src/tools/agent-tool.ts' }],
        [{ name: 'Agent', file: 'packages/somewhere-else/src/profiles.ts' }],
      ),
    ).toEqual([]);
  });

  it('does NOT flag a declaration with no matching produced tool', () => {
    // Inert, not dangerous: it classifies nothing. Flagging it would make the floor fire on a host
    // that pre-declares a profile for a tool it accepts from elsewhere.
    expect(
      findUnclassifiedTools([], [{ name: 'HostSuppliedTool', file: 'packages/p/src/profiles.ts' }]),
    ).toEqual([]);
  });
});

describe('CORE-030 — the declared size is the size that was read', () => {
  it('counts exactly the tools in a fixture of known size, and does not accumulate', () => {
    // measurement-provenance.md: a counter is an output and is tested as one. `::examined::`
    // publishes how many produced names the scan looked at; a number nobody checks is a claim.
    const source = [
      "export const a = createZodFunctionTool('One', d, s, f);",
      "export const b = createZodFunctionTool('Two', d, s, f);",
      "export const c = createZodFunctionTool('Three', d, s, f);",
    ].join('\n');

    expect(producedToolNames(source)).toHaveLength(3);
    // Again, so an accumulating counter is told apart from a per-call one.
    expect(producedToolNames(source)).toHaveLength(3);
  });

  it('reads exactly 3 from a fixture holding exactly 3, and reads 3 again on a second run', () => {
    // An EXACT value against a tree of known size, not a bound: a bound admits an over-count, and
    // an over-counting size reads as more coverage than the scan has. The second run is what tells
    // an accumulating counter apart from a growing subject.
    const root = makeFixtureRoot([
      "export const a = createZodFunctionTool('One', d, s, f);",
      "export const b = createZodFunctionTool('Two', d, s, f);",
      "export const c = createZodFunctionTool('Three', d, s, f);",
    ]);

    collectToolClassification(root);
    expect(examinedProducedToolCount()).toBe(3);
    collectToolClassification(root);
    expect(examinedProducedToolCount()).toBe(3);
  });

  it('counts declared names the same way', () => {
    const source = [
      'export const X_TOOL_PERMISSION_PROFILES = {',
      "  One: { riskClass: 'inspect' },",
      "  Two: { riskClass: 'modify' },",
      '};',
    ].join('\n');
    expect(declaredToolNames(source)).toHaveLength(2);
    expect(declaredToolNames(source)).toHaveLength(2);
  });
});

describe('CORE-030 — fail-closed on an absent tree', () => {
  it('refuses to report a pass over source it could not read', () => {
    // A classification floor that returns "clean" for a checkout it never opened is worse than no
    // floor, because the green reads as evidence.
    expect(() => collectToolClassification('/nonexistent-root-for-core-030')).toThrow(
      /governed tree\(s\) absent/,
    );
  });
});

describe('CORE-030 — the live tree', () => {
  it('classifies every tool it produces', () => {
    // A snapshot. It is worth having because a regression here is silent — but on its own it proves
    // nothing about the check, which is why the divergence fixtures above exist.
    const { produced, declared } = collectToolClassification();
    expect(findUnclassifiedTools(produced, declared)).toEqual([]);
    expect(produced.length).toBeGreaterThan(0);
  });

  it('classifies the four tools that were unknown to the old matrix', () => {
    // Named rather than counted: these are the drift this item was filed about, and two of them
    // execute commands.
    const { declared } = collectToolClassification();
    const names = new Set(declared.map((entry) => entry.name));
    for (const tool of ['Agent', 'BackgroundProcess', 'CodebaseRetrieval', 'ExecuteCommand']) {
      expect(names.has(tool), `${tool} must carry a declared permission profile`).toBe(true);
    }
  });
});
