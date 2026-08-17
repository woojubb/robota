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
    expect(declaredFields(SOURCE, 'p.ts', 'ISource').fields).toEqual(['a', 'b']);
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
      ).fields,
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

describe('the burn-down expires when the work is DONE, not only when the field is deleted', () => {
  // Review measured the earlier version failing exactly this: fixing a pending field printed green,
  // so the list could not tell anyone when an entry was safe to delete. It was a baseline with extra
  // words. `declaredOn` records the measured state and a change in EITHER direction is reported.
  const pendingSettings = (declaredOn) =>
    settings({
      pendingProjection: [{ field: 'b', reason: 'needs a product decision', declaredOn }],
    });

  it('is silent while the recorded state still matches', () => {
    const root = fixture('arch-013-pending-hold-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    expect(findPresetProjectionFindings(root, pendingSettings(['ILive'])).findings).toEqual([]);
  });

  it('reports a pending field that GAINED a declaration — the exemption is earned out', () => {
    // A gain from none to one surface: still pending on the other, so this is the "earned out"
    // message rather than the stronger fully-projected one.
    const root = fixture('arch-013-pending-gain-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, pendingSettings([]));

    expect(findings.map((f) => f.rule)).toEqual(['preset-pending-state-changed']);
    expect(findings[0].detail).toContain('earned out');
  });

  it('reports a pending field that LOST its only declaration — the regression it was hiding', () => {
    const root = fixture('arch-013-pending-loss-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, pendingSettings(['ILive']));

    expect(findings.map((f) => f.rule)).toEqual(['preset-pending-state-changed']);
    expect(findings[0].detail).toContain('LOST a declaration');
  });

  it('suppresses the undeclared and divergence rules for a pending field, and only those', () => {
    // The exemption must cover the field it names and nothing else — otherwise it is a blanket skip.
    const root = fixture('arch-013-pending-scope-', {
      'source.ts': 'export interface ISource {\n  a?: string;\n  b?: string;\n  c?: string;\n}\n',
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ pendingProjection: [{ field: 'b', reason: 'pending', declaredOn: [] }] }),
    );

    expect(findings.map((f) => f.field)).toEqual(['c']);
  });
});

describe('a projection derived from the source is recognised in every form it takes', () => {
  it('sees `extends Pick<Source, …>` on a surface — the form this scan recommends', () => {
    // Review measured the earlier version producing five FALSE divergences on exactly this refactor
    // of the real startup surface. A floor that blocks the fix it exists to encourage gets removed.
    const root = fixture('arch-013-extends-pick-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': "export interface IStartup extends Pick<ISource, 'a' | 'b'> {}\n",
    });

    expect(findPresetProjectionFindings(root, settings()).findings).toEqual([]);
  });

  it('sees fields the SOURCE inherits through `extends`', () => {
    // Review's D1: two brand-new fully-unprojected knobs added via a base interface left the floor
    // green with nothing reported at all.
    const root = fixture('arch-013-source-extends-', {
      'source.ts':
        'export interface IExtras {\n  hidden?: string;\n}\nexport interface ISource extends IExtras {\n  a?: string;\n  b?: string;\n}\n',
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.field)).toEqual(['hidden']);
  });

  it('sees `Omit<Source, …>`, which is `Pick`s sibling and equally derived', () => {
    const root = fixture('arch-013-omit-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
      'startup-plumbing.ts': "export function f(p: Omit<ISource, 'a'>): void {}\n",
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ trackedFiles: ['startup-plumbing.ts'] }),
    );

    expect(findings).toEqual([]);
  });

  it('sees a Pick whose source name is an aliased import', () => {
    const root = fixture('arch-013-alias-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n}\n',
      'startup-plumbing.ts':
        "import type { ISource as IAlias } from './source.js';\nexport function f(p: Pick<IAlias, 'b'>): void {}\n",
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ trackedFiles: ['startup-plumbing.ts'] }),
    );

    expect(findings).toEqual([]);
  });

  it('REPORTS a Pick whose key list yields no literal, rather than reading it as empty', () => {
    const root = fixture('arch-013-unreadable-pick-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
      'startup-plumbing.ts': 'export type T<K extends keyof ISource> = Pick<ISource, K>;\n',
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ trackedFiles: ['startup-plumbing.ts'] }),
    );

    expect(findings.map((f) => f.rule)).toEqual(['preset-projection-heritage-unresolved']);
  });

  it('REPORTS a heritage name declared in another file, rather than reading a narrower type', () => {
    const root = fixture('arch-013-external-heritage-', {
      'source.ts':
        'export interface ISource extends IElsewhere {\n  a?: string;\n  b?: string;\n}\n',
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['preset-projection-heritage-unresolved']);
  });
});

describe('name resolution is SCOPED, so a nested declaration cannot widen the read type', () => {
  it('ignores an interface nested inside a function body', () => {
    // Review round 2: `byName` collected every declaration at any depth, so a nested
    // `interface IStartup { b }` made `b` count as declared by the configured surface. Wider masks
    // findings rather than inventing them, which is the direction that prints as progress.
    const root = fixture('arch-013-nested-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts':
        'export interface IStartup {\n  a?: string;\n}\nexport function f(): void {\n  interface IStartup {\n    b?: string;\n  }\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toEqual(['preset-surface-divergence']);
  });

  it('does not let a nested declaration CANCEL an external-heritage report', () => {
    // The worse half of the same defect: the nested declaration supplied the wrong fields AND
    // suppressed the fail-closed report the external base should have produced.
    const root = fixture('arch-013-nested-cancel-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts':
        'export interface IStartup extends IBase {\n  a?: string;\n}\nexport function f(): void {\n  interface IBase {\n    b?: string;\n  }\n}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toContain('preset-projection-heritage-unresolved');
  });
});

describe('the shared alias map reaches BOTH readers', () => {
  it('resolves `extends Pick<AliasedSource, …>` without a false unresolved report', () => {
    // Round 1's MUST recurring one level in: the alias map lived only in `pickedFields`, so the
    // heritage walk fell through to the external branch and reported a projection it had in fact
    // already counted.
    const root = fixture('arch-013-alias-heritage-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts':
        "import type { ISource as ISrc } from './source.js';\nexport interface IStartup extends Pick<ISrc, 'a' | 'b'> {}\n",
    });

    expect(findPresetProjectionFindings(root, settings()).findings).toEqual([]);
  });
});

describe('an exemption expires when it stops describing a defect', () => {
  it('reports a pending entry whose field is now declared on EVERY surface', () => {
    // Gaming by telling the truth: a correctly-recorded entry for a field with no defect left is
    // otherwise permanent and silent, suppressing both rules forever.
    const root = fixture('arch-013-pending-inert-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({
        pendingProjection: [{ field: 'b', reason: 'pending', declaredOn: ['ILive', 'IStartup'] }],
      }),
    );

    expect(findings.map((f) => f.rule)).toEqual(['preset-pending-state-changed']);
    expect(findings[0].detail).toContain('nothing left to be pending about');
  });

  it('calls a one-for-one SWAP a move, not a loss', () => {
    // Equal lengths, so a length comparison called it a loss. It is the field moving between paths —
    // the `effort`/`agentName` divergence shape.
    const root = fixture('arch-013-pending-swap-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n}\n',
      'startup.ts': 'export interface IStartup {\n  a?: string;\n  b?: string;\n}\n',
    });

    const { findings } = findPresetProjectionFindings(
      root,
      settings({ pendingProjection: [{ field: 'b', reason: 'pending', declaredOn: ['ILive'] }] }),
    );

    expect(findings.map((f) => f.rule)).toEqual(['preset-pending-state-changed']);
    expect(findings[0].detail).toContain('MOVED between surfaces');
  });
});

describe('an unmodelled utility type in a heritage clause is named for what it is', () => {
  it('does not call `Partial<Source>` a base interface declared in another file', () => {
    const root = fixture('arch-013-utility-', {
      'source.ts': SOURCE,
      'live.ts': 'export interface ILive {\n  a?: string;\n  b?: string;\n}\n',
      'startup.ts': 'export interface IStartup extends Partial<ISource> {}\n',
    });

    const { findings } = findPresetProjectionFindings(root, settings());

    expect(findings.map((f) => f.rule)).toContain('preset-projection-heritage-unresolved');
    expect(
      findings.find((f) => f.rule === 'preset-projection-heritage-unresolved').detail,
    ).toContain('a utility type this walk does not model');
  });
});
