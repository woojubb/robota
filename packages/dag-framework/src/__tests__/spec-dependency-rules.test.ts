/**
 * Issue #2165 — the SPEC's Dependency Rules and the manifest describe the same package.
 *
 * The SPEC omitted `dag-builder` and `dag-projection` and forbade every `@robota-sdk/agent-*` import
 * while the manifest had depended on `agent-core`, `dag-builder` and `dag-projection` for as long as
 * the rule existed. Nothing compared the two. This does: every `@robota-sdk` runtime dependency the
 * manifest declares must be named in the SPEC's allowed list, and none may be a concrete provider
 * or an upper agent-runtime package — the prohibition the approved architecture actually makes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..');

interface IManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Every `@robota-sdk/*` package the manifest installs for a consumer, without the scope. */
function workspaceRuntimeDependencies(): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as IManifest;
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  })
    .filter((name) => name.startsWith('@robota-sdk/'))
    .map((name) => name.slice('@robota-sdk/'.length));
}

/** The `## Dependency Rules` section of the SPEC, and nothing after it. */
function dependencyRulesSection(): string {
  const spec = readFileSync(path.join(PACKAGE_ROOT, 'docs/SPEC.md'), 'utf8');
  const start = spec.indexOf('## Dependency Rules');
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = spec.slice(start + '## Dependency Rules'.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The prohibition the approved architecture makes — concrete providers and the upper runtime. */
const FORBIDDEN = [
  /^agent-provider-/,
  /^agent-(framework|session|executor|cli|tools|command|preset|plugin|transport|subagent-runner)$/,
];

describe('dag-framework Dependency Rules agree with the manifest (issue #2165)', () => {
  const rules = dependencyRulesSection();
  const dependencies = workspaceRuntimeDependencies();

  it('reads a non-empty dependency set (the subject is not empty)', () => {
    expect(dependencies.length).toBeGreaterThan(0);
  });

  it('every workspace dependency in the manifest is named in the allowed list', () => {
    const unnamed = dependencies.filter((name) => {
      // Named bare (`dag-core`) or with its scope (`@robota-sdk/agent-core`) — both are the SPEC's forms.
      if (rules.includes(`\`${name}\``) || rules.includes(`\`@robota-sdk/${name}\``)) return false;
      // The default node packages are allowed as a family: `dag-node-*`.
      return !(name.startsWith('dag-node-') && rules.includes('`dag-node-*`'));
    });
    expect(unnamed).toEqual([]);
  });

  it('the manifest depends on no concrete provider or upper agent-runtime package', () => {
    const violations = dependencies.filter((name) =>
      FORBIDDEN.some((pattern) => pattern.test(name)),
    );
    expect(violations).toEqual([]);
  });

  it('the SPEC states the narrowed prohibition rather than forbidding all of agent-*', () => {
    expect(rules).not.toMatch(/MUST NOT import `@robota-sdk\/agent-\*` packages/);
    expect(rules).toContain('`@robota-sdk/agent-core`');
  });
});
