import { describe, expect, it } from 'vitest';

import {
  findForbiddenDependencies,
  findIoViolations,
  findProductNameConditionals,
  scanCompositionNeutrality,
} from '../scan-composition-neutrality.mjs';

/**
 * ARCH-005 — the composition-neutrality guards. Each `find*` is a pure content check, so we prove it FAILS
 * on a planted violation (red) and does not false-positive on clean/neutral code.
 */

const RULE = {
  dir: 'packages/agent-product',
  forbiddenDependencies: ['@robota-sdk/agent-cli', '@robota-sdk/agent-transport'],
  forbiddenDependencyPrefixes: ['@robota-sdk/agent-transport'],
  forbiddenImports: ['node:fs', 'fs', 'node:fs/promises'],
  forbiddenIdentifiers: ['process.env', 'readSettings', 'createProviderFromSettings'],
};

describe('guard (a) — dependency-graph neutrality', () => {
  it('FLAGS a concrete transport/CLI dependency (exact + prefix)', () => {
    const manifest = {
      dependencies: { '@robota-sdk/agent-cli': 'workspace:*', '@robota-sdk/agent-framework': 'workspace:*' },
      devDependencies: { '@robota-sdk/agent-transport-tui': 'workspace:*' },
    };
    const ids = findForbiddenDependencies(manifest, RULE).map((f) => f.id);
    expect(ids).toContain('@robota-sdk/agent-cli'); // exact
    expect(ids).toContain('@robota-sdk/agent-transport-tui'); // prefix
  });

  it('does NOT flag the allowed neutral deps (framework/preset/capability-pack/interface-transport)', () => {
    const manifest = {
      dependencies: {
        '@robota-sdk/agent-framework': 'workspace:*',
        '@robota-sdk/agent-preset': 'workspace:*',
        '@robota-sdk/agent-capability-pack': 'workspace:*',
        '@robota-sdk/agent-interface-transport': 'workspace:*',
        '@robota-sdk/agent-core': 'workspace:*',
      },
    };
    expect(findForbiddenDependencies(manifest, RULE)).toEqual([]);
  });
});

describe('guard (b) — purity / no-IO', () => {
  it('FLAGS a forbidden fs import', () => {
    const kinds = findIoViolations("import { readFileSync } from 'node:fs';", 'x.ts', RULE).map((f) => f.kind);
    expect(kinds).toContain('forbidden-io-import');
  });

  it('FLAGS a process.env read and a settings-reader identifier', () => {
    expect(findIoViolations('const t = process.env.ROBOTA_WS_TOKEN;', 'x.ts', RULE).map((f) => f.id)).toContain('process.env');
    expect(findIoViolations('const s = readSettings(path);', 'x.ts', RULE).map((f) => f.id)).toContain('readSettings');
    expect(
      findIoViolations('const p = createProviderFromSettings(cwd);', 'x.ts', RULE).map((f) => f.id),
    ).toContain('createProviderFromSettings');
  });

  it('does NOT flag neutral code or a similarly-named identifier', () => {
    expect(findIoViolations('const merged = mergeCapabilityPacks(base, packs);', 'x.ts', RULE)).toEqual([]);
    // A different identifier that merely CONTAINS a forbidden one must not match (word boundary).
    expect(findIoViolations('const x = myReadSettingsHelper();', 'x.ts', RULE)).toEqual([]);
    // A commented-out import is not a real IO edge.
    expect(findIoViolations("// import { readFileSync } from 'node:fs';", 'x.ts', RULE)).toEqual([]);
  });
});

describe('guard (c) — no product-name conditionals', () => {
  it('FLAGS a product-identity conditional (=== and !==)', () => {
    expect(findProductNameConditionals("if (profile.id === 'robota') { doThing(); }", 'x.ts')).toHaveLength(1);
    expect(findProductNameConditionals("if (opts.agentName !== 'robota') skip();", 'x.ts')).toHaveLength(1);
  });

  it('does NOT flag id equality against a variable, or non-identity comparisons', () => {
    // Comparing ids against each other (a merge dedup) is fine — only a STRING-LITERAL identity branch is banned.
    expect(findProductNameConditionals('if (module.name === other.name) reject();', 'x.ts')).toEqual([]);
    expect(findProductNameConditionals("if (kind === 'tool') handle();", 'x.ts')).toEqual([]);
    expect(findProductNameConditionals("// profile.id === 'robota' would be a violation", 'x.ts')).toEqual([]);
  });
});

describe('the real agent-product package is neutral (guards hold on the live tree)', () => {
  it('reports zero findings against the configured packages', () => {
    expect(scanCompositionNeutrality()).toEqual([]);
  });
});
