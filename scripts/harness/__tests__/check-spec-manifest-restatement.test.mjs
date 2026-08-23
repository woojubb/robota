import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  collectSpecs,
  examinedSpecCount,
  findLayerRestatements,
} from '../check-spec-manifest-restatement.mjs';

function createFixture(files) {
  const root = makeTemp('robota-spec-manifest-restatement-');
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

/**
 * DOCS-028 (issue #2194) — the decision is tested through the exported predicate, not through
 * `main()`.
 *
 * ARCH-101 established why: a guard reachable only through `main()` is a guard no test can falsify,
 * and `regression-red-proof` found exactly that shape when the layer condition lived inline in a
 * scan's `main()` while the tests exercised only the shared predicate. Here the predicate IS the
 * decision, so neutering it turns these red.
 *
 * The two rows in `RESTATEMENTS` are the real claims this scan was written for — both were live in
 * the tree and both were FALSE: `agent-builtin-providers` said "agent-core only" while depending on
 * four provider siblings, and `agent-provider-openai` said the same while depending on
 * `agent-provider-openai-compatible`.
 */
const NAMES = [
  '@robota-sdk/agent-provider-openai-compatible',
  '@robota-sdk/agent-builtin-providers',
  'agent-provider-openai-compatible',
  'agent-builtin-providers',
  'agent-provider-openai',
  'agent-tool-defaults',
  'agent-framework',
  'agent-core',
  'agent-tools',
  'tool',
];

const spec = (layerLine) => ({
  file: 'packages/x/docs/SPEC.md',
  text: `# SPEC: x\n\n## Package Identity\n\n- **npm name**: \`@robota-sdk/x\`\n${layerLine}\n- **Platform**: node\n`,
});

describe('a SPEC may not restate the dependency set its manifest owns', () => {
  it('refuses the exact claim that was false in the tree', () => {
    const found = findLayerRestatements(
      [
        spec(
          '- **Layer**: Layer 1 (depends on `agent-core` only among framework packages; never imports from `agent-framework`)',
        ),
      ],
      NAMES,
    );
    expect(found).toHaveLength(1);
    expect(found[0].named).toContain('agent-core');
  });

  it('refuses a claim naming the scoped package specifier', () => {
    const found = findLayerRestatements(
      [spec('- **Layer**: composition leaf (depends on `@robota-sdk/agent-tools`)')],
      NAMES,
    );
    expect(found).toHaveLength(1);
  });

  it('accepts a layer name that points at the owner instead of enumerating', () => {
    const found = findLayerRestatements(
      [
        spec(
          "- **Layer**: Layer 1 — the dependency set that places it there is declared in this package's manifest and enforced by `check-dependency-direction.mjs`; not restated here",
        ),
      ],
      NAMES,
    );
    expect(found).toEqual([]);
  });

  it('does not match a package name as a substring of a longer one', () => {
    // `tool` is a whole-token match only: a Layer field mentioning `agent-tool-defaults` must not be
    // reported for `tool`. `\b` cannot express this, because a hyphen is itself a word boundary.
    const found = findLayerRestatements(
      [spec('- **Layer**: the tool-defaults composition leaf')],
      ['tool'],
    );
    expect(found).toEqual([]);
  });

  it('reports the longest matching name rather than a prefix of it', () => {
    const found = findLayerRestatements(
      [spec('- **Layer**: Layer 1 (depends on `agent-provider-openai-compatible`)')],
      NAMES,
    );
    expect(found).toHaveLength(1);
    expect(found[0].named).toContain('agent-provider-openai-compatible');
    expect(found[0].named).not.toContain('agent-provider-openai');
  });

  it('ignores a SPEC with no Layer field at all', () => {
    const found = findLayerRestatements(
      [{ file: 'packages/y/docs/SPEC.md', text: '# SPEC: y\n\n## Scope\n\nSomething.\n' }],
      NAMES,
    );
    expect(found).toEqual([]);
  });
});

describe('DOCS-028 — the scan reports the size of what it examined', () => {
  it('counts the SPECs it walked, and does not accumulate across runs', () => {
    // measurement-provenance.md: a counter is an output and is tested as one. "examined 0 SPECs"
    // reads exactly like a clean tree, which is why the number itself must be asserted — and
    // asserted against a fixture, so the expected value is a property of the fixture rather than of
    // whatever the workspace happens to hold today.
    const root = createFixture({
      'packages/one/package.json': '{"name":"@robota-sdk/one"}',
      'packages/one/docs/SPEC.md': '# SPEC: one\n',
      'packages/two/package.json': '{"name":"@robota-sdk/two"}',
      'packages/two/docs/SPEC.md': '# SPEC: two\n',
      // A package with no SPEC is another scan's finding, not this one's, and must not be counted.
      'packages/three/package.json': '{"name":"@robota-sdk/three"}',
    });

    collectSpecs(root);
    expect(examinedSpecCount()).toBe(2);

    // Run it AGAIN over the same fixture: an accumulating counter would say 4.
    collectSpecs(root);
    expect(examinedSpecCount(), 'the counter accumulates across runs').toBe(2);
  });

  it('refuses a root without the tree it governs rather than reporting zero', () => {
    // guard-scope-fail-closed: "no findings" over an unread corpus reads identically to a clean one.
    const bare = makeTemp('robota-spec-manifest-restatement-bare-');
    expect(() => collectSpecs(bare)).toThrow(/packages/);
  });
});
