import { describe, expect, it } from 'vitest';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  declaredFields,
  examinedInterfaceCount,
  findPresetProjectionFindings,
  pickedFields,
} from '../scan-preset-projection.mjs';

/**
 * ARCH-013 stage 2. Every rule below is asserted in BOTH directions — it fires on the shape it
 * names, and it stays silent on the shape it does not. A floor that only ever reports zero is worse
 * than no floor, and this repo has shipped two of those (`questionToken`, `.default`); both were
 * caught by falsifying the rule against a real evasion rather than by reading it.
 */
function fixture(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'packages'), { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents);
  return root;
}

const SOURCE = 'export interface ISource {\n  a?: string;\n  b?: string;\n}\n';

function settings(extra = {}) {
  return {
    source: { file: 'source.ts', interface: 'ISource' },
    surfaces: [
      { file: 'live.ts', interface: 'ILive', role: 'live', paths: ['live'] },
      { file: 'startup.ts', interface: 'IStartup', role: 'startup', paths: ['startup'] },
    ],
    derivationOnly: [],
    trackedFiles: [],
    ...extra,
  };
}

describe('declaredFields', () => {
  it('reads the declared property names in order', () => {
    expect(declaredFields(SOURCE, 'p.ts', 'ISource')).toEqual(['a', 'b']);
  });

  it('answers undefined for an interface the file does not declare — not an empty list', () => {
    // "declared and empty" and "not declared at all" must not read alike: the second means the floor
    // has lost its subject, and reporting it as zero fields would print a clean result.
    expect(declaredFields(SOURCE, 'p.ts', 'IMissing')).toBeUndefined();
  });

  it('ACCUMULATES across two declarations of one name, as TypeScript merges them', () => {
    expect(
      declaredFields(
        'export interface ISource {\n  a?: string;\n}\nexport interface ISource {\n  b?: string;\n}\n',
        'p.ts',
        'ISource',
      ),
    ).toEqual(['a', 'b']);
  });
});

describe('pickedFields', () => {
  it('reads the keys of a Pick of the source type', () => {
    const picks = pickedFields(
      "function f(p: Pick<ISource, 'a' | 'b'>): void {}\n",
      'p.ts',
      'ISource',
    );

    expect(picks).toHaveLength(1);
    expect(picks[0].fields).toEqual(['a', 'b']);
  });

  it('ignores a Pick of some OTHER type', () => {
    expect(pickedFields("type T = Pick<IOther, 'a'>;\n", 'p.ts', 'ISource')).toEqual([]);
  });

  it('reads a single-key Pick, which has no union to walk', () => {
    expect(pickedFields("type T = Pick<ISource, 'a'>;\n", 'p.ts', 'ISource')[0].fields).toEqual([
      'a',
    ]);
  });
});

describe('a source field that reaches no surface is a finding', () => {
  it('flags it, and names the surfaces it checked', () => {
    const root = fixture('arch-013-unprojected-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings, examined } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['preset-field-undeclared']);
    expect(findings[0].field).toBe('b');
    expect(examined).toBe(3);
    expect(examinedInterfaceCount(), 'the walk was miscounted').toBe(3);

    // Again over the SAME fixture: an accumulating counter would say 6. That is what tells a
    // counter reset each run apart from one that only ever grows (measurement-provenance.md).
    findPresetProjectionFindings(root, settings());
    expect(examinedInterfaceCount(), 'the counter accumulates across runs').toBe(3);
  });

  it('does NOT flag a field a `Pick` projects — the form that is derived from the source', () => {
    // Measured on the real tree before this was handled: the startup path projects the
    // command-module group through `Pick<IResolvedPresetOptions, …>` rather than through its named
    // interface, and calling that a defect is how a floor gets allowlisted into silence.
    const root = fixture('arch-013-pick-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
      'startup-plumbing.ts': "export function f(p: Pick<ISource, 'b'>): void {}\n",
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ trackedFiles: ['startup-plumbing.ts'] }),
    );

    expect(findings).toEqual([]);
  });

  it('does NOT flag a field listed as derivation-only', () => {
    const root = fixture('arch-013-derived-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ derivationOnly: [{ field: 'b', reason: 'promoted into `a` by the resolver' }] }),
    );

    expect(findings).toEqual([]);
  });
});

describe('the two surfaces must agree', () => {
  it('flags a field the LIVE path applies and startup drops — the `effort` class', () => {
    const root = fixture('arch-013-diverge-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['preset-surface-divergence']);
    expect(findings[0].field).toBe('b');
  });

  it('flags the REVERSE direction too — startup applies, the live path drops', () => {
    // `agentName` is the real instance: starting with a preset sets the agent name, switching to it
    // mid-session does not. The rule is symmetric because the defect is.
    const root = fixture('arch-013-diverge-rev-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['preset-surface-divergence']);
  });

  it('is silent when both surfaces carry the same fields', () => {
    const root = fixture('arch-013-agree-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    expect(findPresetProjectionFindings(root, settings()).findings).toEqual([]);
  });

  it('does NOT flag a surface field that is not a source field', () => {
    // `activePresetId` is on the startup surface and is not a preset field — it is the id itself.
    // A rule comparing raw surface members would report it forever.
    const root = fixture('arch-013-extra-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts':
        'export interface IStartup {\n  a?: string;\n  b?: string;\n  activePresetId: string;\n}\n',
    });

    expect(findPresetProjectionFindings(root, settings()).findings).toEqual([]);
  });
});

describe('the floor fails closed rather than measuring nothing', () => {
  it('flags a source interface that is not declared where configured', () => {
    const root = fixture('arch-013-src-gone-', {
      'source.ts': 'export interface IRenamed {\n  a?: string;\n}\n',
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['preset-projection-source-missing']);
  });

  it('flags a surface interface that is not declared where configured', () => {
    const root = fixture('arch-013-surface-gone-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface IRenamed {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toContain('preset-projection-surface-missing');
  });

  it('flags an empty scope at either config key', () => {
    expect(
      findPresetProjectionFindings(process.cwd(), settings({ surfaces: [] })).findings.map(
        (f) => f.rule,
      ),
    ).toEqual(['preset-projection-scope-empty']);
    expect(
      findPresetProjectionFindings(process.cwd(), settings({ source: undefined })).findings.map(
        (f) => f.rule,
      ),
    ).toEqual(['preset-projection-scope-empty']);
  });

  it('flags a Pick that sits under no declared surface path', () => {
    // Otherwise the `paths` list could silently narrow what "the startup path" means, and a
    // projection nobody attributed would count for neither side of the divergence rule.
    const root = fixture('arch-013-unattributed-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
      'elsewhere.ts': "export function f(p: Pick<ISource, 'a'>): void {}\n",
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ trackedFiles: ['elsewhere.ts'] }),
    );

    expect(findings.map((f) => f.rule)).toEqual(['preset-projection-unattributed']);
  });

  it('flags a derivation-only entry that matches no live source field', () => {
    const root = fixture('arch-013-stale-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ derivationOnly: [{ field: 'gone', reason: 'was promoted, then removed' }] }),
    );

    expect(findings.map((f) => f.rule)).toEqual(['preset-exemption-unused']);
  });
});
