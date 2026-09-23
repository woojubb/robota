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

/** The prohibition the approved architecture makes — concrete providers and the upper runtime. */
const FORBIDDEN = [
  /^agent-provider-/,
  /^agent-(framework|session|executor|cli|tools|command|preset|plugin|transport|subagent-runner)$/,
];

describe('dag-framework manifest dependency boundary', () => {
  const dependencies = workspaceRuntimeDependencies();

  it('reads a non-empty dependency set (the subject is not empty)', () => {
    expect(dependencies.length).toBeGreaterThan(0);
  });

  it('the manifest depends on no concrete provider or upper agent-runtime package', () => {
    const violations = dependencies.filter((name) =>
      FORBIDDEN.some((pattern) => pattern.test(name)),
    );
    expect(violations).toEqual([]);
  });
});
