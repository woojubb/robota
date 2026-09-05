import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadHarnessConfig } from '../harness-config.mjs';
import {
  findForbiddenDependencies,
  findIoViolations,
  findProductNameConditionals,
  formatFinding,
  scanCompositionNeutrality,
} from '../scan-composition-neutrality.mjs';

/**
 * ARCH-005 — the composition-neutrality guards. Each `find*` is a pure content check, so we prove it FAILS
 * on a planted violation (red) and does not false-positive on clean/neutral code.
 */

const RULE = {
  dir: 'packages/agent-product',
  forbiddenDependencies: [
    '@robota-sdk/agent-cli',
    '@robota-sdk/agent-transport',
    '@robota-sdk/agent-executor',
  ],
  forbiddenDependencyPrefixes: ['@robota-sdk/agent-transport'],
  forbiddenImports: ['node:fs', 'fs', 'node:fs/promises'],
  forbiddenIdentifiers: [
    'process.env',
    'globalThis.process',
    'readSettings',
    'createProviderFromSettings',
  ],
};

describe('guard (a) — dependency-graph neutrality', () => {
  it('FLAGS a concrete transport/CLI dependency (exact + prefix)', () => {
    const manifest = {
      dependencies: {
        '@robota-sdk/agent-cli': 'workspace:*',
        '@robota-sdk/agent-framework': 'workspace:*',
      },
      devDependencies: { '@robota-sdk/agent-transport-tui': 'workspace:*' },
    };
    const ids = findForbiddenDependencies(manifest, RULE).map((f) => f.id);
    expect(ids).toContain('@robota-sdk/agent-cli'); // exact
    expect(ids).toContain('@robota-sdk/agent-transport-tui'); // prefix
  });

  // ARCH-005 S2 (reviewer remediation): agent-executor is a concrete-runtime package (child-process runners,
  // subagent/background managers). The kernel takes those as INJECTED profile plumbing, never as a dep.
  it('FLAGS an agent-executor dependency', () => {
    const manifest = { dependencies: { '@robota-sdk/agent-executor': 'workspace:*' } };
    expect(findForbiddenDependencies(manifest, RULE).map((f) => f.id)).toContain(
      '@robota-sdk/agent-executor',
    );
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
  it('rejects moved transport-host symbols through the allowed framework dependency', () => {
    const symbols = [
      'createHeadlessTransport',
      'HeadlessInteractionChannel',
      'createProgrammaticAgent',
      'TransportRegistry',
      'createFileTransportSettingsRepository',
    ];
    const rules = loadHarnessConfig().compositionNeutrality.filter((rule) =>
      ['packages/agent-product', 'packages/agent-capability-pack'].includes(rule.dir),
    );
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      for (const symbol of symbols) {
        const source = `import { ${symbol} } from '@robota-sdk/agent-framework';\nconst host = ${symbol}();`;
        expect(
          findIoViolations(source, 'src/host.ts', rule).map((finding) => finding.id),
        ).toContain(symbol);
      }
    }
  });

  it('FLAGS a forbidden fs import', () => {
    const kinds = findIoViolations("import { readFileSync } from 'node:fs';", 'x.ts', RULE).map(
      (f) => f.kind,
    );
    expect(kinds).toContain('forbidden-io-import');
  });

  it('FLAGS a process.env read and a settings-reader identifier', () => {
    expect(
      findIoViolations('const t = process.env.ROBOTA_WS_TOKEN;', 'x.ts', RULE).map((f) => f.id),
    ).toContain('process.env');
    expect(
      findIoViolations('const s = readSettings(path);', 'x.ts', RULE).map((f) => f.id),
    ).toContain('readSettings');
    expect(
      findIoViolations('const p = createProviderFromSettings(cwd);', 'x.ts', RULE).map((f) => f.id),
    ).toContain('createProviderFromSettings');
  });

  // ARCH-005 S2 (reviewer remediation): `globalThis.process.env` evades the bare `process.env` identifier
  // (its lookbehind rejects a preceding `.`), so the qualified form is banned explicitly.
  it('FLAGS a globalThis.process env read (qualified-global evasion)', () => {
    expect(
      findIoViolations('const t = globalThis.process.env.ROBOTA_WS_TOKEN;', 'x.ts', RULE).map(
        (f) => f.id,
      ),
    ).toContain('globalThis.process');
  });

  it('does NOT flag neutral code or a similarly-named identifier', () => {
    expect(
      findIoViolations('const merged = mergeCapabilityPacks(base, packs);', 'x.ts', RULE),
    ).toEqual([]);
    // A different identifier that merely CONTAINS a forbidden one must not match (word boundary).
    expect(findIoViolations('const x = myReadSettingsHelper();', 'x.ts', RULE)).toEqual([]);
    // A commented-out import is not a real IO edge.
    expect(findIoViolations("// import { readFileSync } from 'node:fs';", 'x.ts', RULE)).toEqual(
      [],
    );
  });
});

describe('guard (c) — no product-name conditionals', () => {
  it('FLAGS a product-identity conditional (=== and !==)', () => {
    expect(
      findProductNameConditionals("if (profile.id === 'robota') { doThing(); }", 'x.ts'),
    ).toHaveLength(1);
    expect(
      findProductNameConditionals("if (opts.agentName !== 'robota') skip();", 'x.ts'),
    ).toHaveLength(1);
  });

  // ARCH-005 S2 (reviewer remediation): equality was only ONE way to special-case a product. Each of the
  // evasions below reaches the same "hard-code a product's choices" outcome without an `===`, so each is
  // planted here red-first and must be FLAGGED.
  it('FLAGS a switch on a product identity (switch-statement evasion)', () => {
    expect(findProductNameConditionals('switch (profile.id) {', 'x.ts')).toHaveLength(1);
    expect(findProductNameConditionals('  switch (opts.agentName) {', 'x.ts')).toHaveLength(1);
  });

  it('FLAGS startsWith/includes/endsWith on a product identity (string-predicate evasion)', () => {
    expect(
      findProductNameConditionals("if (profile.id.startsWith('robota')) {", 'x.ts'),
    ).toHaveLength(1);
    expect(
      findProductNameConditionals("if (profile.agentName.includes('acme')) {", 'x.ts'),
    ).toHaveLength(1);
    expect(findProductNameConditionals("if (profile.id.endsWith('-cli')) {", 'x.ts')).toHaveLength(
      1,
    );
  });

  it('FLAGS an index lookup keyed by a product identity (lookup-table evasion)', () => {
    expect(
      findProductNameConditionals('const wiring = PRODUCT_WIRING[profile.id];', 'x.ts'),
    ).toHaveLength(1);
    expect(
      findProductNameConditionals('return TABLE[profile.agentName] ?? fallback;', 'x.ts'),
    ).toHaveLength(1);
  });

  it('FLAGS a template-literal identity equality', () => {
    expect(findProductNameConditionals('if (profile.id === `robota`) {', 'x.ts')).toHaveLength(1);
  });

  it('does NOT flag id equality against a variable, or non-identity comparisons', () => {
    // Comparing ids against each other (a merge dedup) is fine — only a STRING-LITERAL identity branch is banned.
    expect(
      findProductNameConditionals('if (module.name === other.name) reject();', 'x.ts'),
    ).toEqual([]);
    expect(findProductNameConditionals("if (kind === 'tool') handle();", 'x.ts')).toEqual([]);
    expect(
      findProductNameConditionals("// profile.id === 'robota' would be a violation", 'x.ts'),
    ).toEqual([]);
  });

  it('does NOT flag neutral property passthrough, array indexing, or non-identity lookups', () => {
    // The assembler's own identity passthrough must stay clean (it reads the field, it does not branch).
    expect(findProductNameConditionals('    id: profile.id,', 'x.ts')).toEqual([]);
    expect(
      findProductNameConditionals(
        '    ...(profile.agentName !== undefined ? { agentName: profile.agentName } : {}),',
        'x.ts',
      ),
    ).toEqual([]);
    // Numeric / variable indexing is not an identity lookup table.
    expect(findProductNameConditionals('const first = packs[0];', 'x.ts')).toEqual([]);
    expect(findProductNameConditionals('const hit = byName[module.name];', 'x.ts')).toEqual([]);
    // A generic switch is fine — only a switch on a product IDENTITY is banned.
    expect(findProductNameConditionals('switch (contribution.kind) {', 'x.ts')).toEqual([]);
    // `.includes` on a non-identity collection is normal merge code.
    expect(
      findProductNameConditionals('if (claimedIds.includes(pack.id)) reject();', 'x.ts'),
    ).toEqual([]);
  });
});

/**
 * HARNESS-048 — the evasions the line-regex guard could not see. ARCH-005 S2 planted a probe file
 * containing ALL of these in `packages/agent-product/src` and the scan still printed "passed", so each is
 * pinned here red-first: an evadable guard is a rule that is not enforced.
 */
describe('HARNESS-048 — evasions of the line-regex guard (AST hardening)', () => {
  it('FLAGS a DESTRUCTURED identity equality (`const { id } = profile; id === "robota"`)', () => {
    const source = "const { id } = profile;\nif (id === 'robota') doThing();";
    const findings = findProductNameConditionals(source, 'x.ts');
    expect(findings.map((f) => f.id)).toContain('equality');
    // The alias is renameable — the aliased binding form must be caught too.
    expect(
      findProductNameConditionals(
        "const { id: which } = profile;\nif (which !== 'acme') skip();",
        'x.ts',
      ),
    ).not.toEqual([]);
  });

  it('FLAGS a NESTED destructured identity (`const { profile: { id } } = opts`)', () => {
    const source = "const {\n  profile: { id },\n} = opts;\nif (id === 'robota') doThing();";
    expect(findProductNameConditionals(source, 'x.ts').map((f) => f.id)).toContain('equality');
    // …and through an array pattern, where the binding carries no named path segment.
    expect(
      findProductNameConditionals(
        'const [{ agentName }] = profiles;\nswitch (agentName) {\n}',
        'x.ts',
      ),
    ).not.toEqual([]);
  });

  it('FLAGS an ALIASED identity string predicate (`const a = profile.id; a.startsWith(…)`)', () => {
    const source = "const alias = profile.id;\nif (alias.startsWith('acme')) doThing();";
    expect(findProductNameConditionals(source, 'x.ts').map((f) => f.id)).toContain(
      'string-predicate',
    );
  });

  it('FLAGS a COMPUTED identity index (`table[profile["id"]]`)', () => {
    expect(findProductNameConditionals("const w = table[profile['id']];", 'x.ts')).toHaveLength(1);
  });

  it('FLAGS an aliased identity switch (`const { agentName } = p; switch (agentName)`)', () => {
    const source = 'const { agentName } = profile;\nswitch (agentName) {\n  case 1: break;\n}';
    expect(findProductNameConditionals(source, 'x.ts').map((f) => f.id)).toContain('switch');
  });

  it('FLAGS the BRACKET form of a banned identifier (`globalThis["process"].env["HOME"]`)', () => {
    expect(
      findIoViolations("const h = globalThis['process'].env['HOME'];", 'x.ts', RULE).map(
        (f) => f.id,
      ),
    ).toContain('globalThis.process');
  });

  it('FLAGS an ALIASED process (`const proc = process; proc.env["HOME"]`)', () => {
    const source = "const proc = process;\nconst h = proc.env['HOME'];";
    expect(findIoViolations(source, 'x.ts', RULE).map((f) => f.id)).toContain('process.env');
  });

  it('FLAGS a dynamic `import()` of a forbidden module', () => {
    expect(
      findIoViolations("const fs = await import('node:fs');", 'x.ts', RULE).map((f) => f.kind),
    ).toContain('forbidden-io-import');
    expect(
      findIoViolations("const fs = require('node:fs/promises');", 'x.ts', RULE).map((f) => f.id),
    ).toContain('node:fs/promises');
  });

  it('FLAGS a member access split across lines', () => {
    const source = 'const t = process\n  .env\n  .ROBOTA_WS_TOKEN;';
    expect(findIoViolations(source, 'x.ts', RULE).map((f) => f.id)).toContain('process.env');
  });

  it('FLAGS an identity equality split across lines', () => {
    const source = "if (\n  profile.id ===\n  'robota'\n) doThing();";
    expect(findProductNameConditionals(source, 'x.ts').map((f) => f.id)).toContain('equality');
  });

  it('does NOT flag a member access that merely LOOKS like one (`x.readSettings`, `process.cwd`)', () => {
    // `.readSettings` on some other object is a method call, not the banned module-level reader.
    expect(findIoViolations('const s = host.readSettings();', 'x.ts', RULE)).toEqual([]);
    // Only `process.env` is banned — `process.cwd()` appears in the package's own tests.
    expect(findIoViolations('const cwd = process.cwd();', 'x.ts', RULE)).toEqual([]);
    // A declaration NAME that shadows a banned reader is not an IO edge.
    expect(findIoViolations('const readSettings = 1;', 'x.ts', RULE)).toEqual([]);
    expect(findIoViolations("const o = { readSettings: 'x' };", 'x.ts', RULE)).toEqual([]);
  });
});

describe('HARNESS-048 — the finding reports WHICH dependency/identifier was found', () => {
  it('prints the offending dependency name (previously dropped by the reporter)', () => {
    const [finding] = findForbiddenDependencies(
      { dependencies: { '@robota-sdk/agent-cli': 'workspace:*' } },
      RULE,
    ).map((f) => ({ ...f, dir: 'packages/agent-product' }));
    expect(formatFinding(finding)).toContain('@robota-sdk/agent-cli');
    expect(formatFinding(finding)).toContain('packages/agent-product');
  });

  it('prints the offending identifier and the source line for a content finding', () => {
    const [finding] = findIoViolations('const t = process.env.HOME;', 'src/a.ts', RULE);
    const line = formatFinding(finding);
    expect(line).toContain('process.env');
    expect(line).toContain('src/a.ts:1');
  });
});

describe('a missing scan target is a hard finding, never a silent no-op', () => {
  it('reports scan-target-missing for a configured package that does not exist', () => {
    const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
    const findings = scanCompositionNeutrality(workspaceRoot, [
      { dir: 'packages/does-not-exist', forbiddenImports: [], forbiddenIdentifiers: [] },
    ]);
    expect(findings.map((f) => f.kind)).toEqual(['scan-target-missing', 'scan-target-missing']);
    expect(findings.map((f) => f.id)).toContain('packages/does-not-exist/src');
    expect(findings.map((f) => f.id)).toContain('packages/does-not-exist/package.json');
  });
});

describe('the real configured packages are neutral (guards hold on the live tree)', () => {
  it('reports zero findings against the configured packages', () => {
    expect(scanCompositionNeutrality()).toEqual([]);
  });

  // HARNESS-048: agent-capability-pack is an equally pure published contract package and was unscanned.
  it('covers agent-product AND agent-capability-pack', () => {
    const dirs = loadHarnessConfig().compositionNeutrality.map((r) => r.dir);
    expect(dirs).toContain('packages/agent-product');
    expect(dirs).toContain('packages/agent-capability-pack');
  });
});
