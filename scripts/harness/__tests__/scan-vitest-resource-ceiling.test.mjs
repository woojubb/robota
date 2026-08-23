import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  ceilingViolation,
  findCeilingFindings,
  findVitestConfigs,
} from '../scan-vitest-resource-ceiling.mjs';

const CEILING_IMPORT = "import { resourceCeiling } from '../../vitest.shared';";

function scratch() {
  const root = makeTemp('vitest-ceiling-');
  mkdirSync(path.join(root, 'packages'), { recursive: true });
  return root;
}

function writeConfig(root, pkg, source) {
  const dir = path.join(root, 'packages', pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'vitest.config.ts'), source);
}

function writeShared(root) {
  writeFileSync(path.join(root, 'vitest.shared.ts'), 'export const resourceCeiling = {};\n');
}

describe('ceilingViolation', () => {
  it('accepts a config that imports the ceiling AND merges it', () => {
    expect(
      ceilingViolation(`${CEILING_IMPORT}\nexport default mergeConfig(resourceCeiling, x);`),
    ).toBeNull();
  });

  it('rejects a config that inherits nothing', () => {
    expect(ceilingViolation("import { defineConfig } from 'vitest/config';")).toMatch(
      /does not import/,
    );
  });

  // The failure mode worth catching: it reads as correct and applies nothing. A config that imports
  // the ceiling but never merges it gets V8's RAM-derived heap limit back — 4144 MB on a 23 GB host,
  // which is what the 2026-07-26 OOM rode to the top.
  it('rejects an import that is never passed to mergeConfig', () => {
    expect(ceilingViolation(`${CEILING_IMPORT}\nexport default defineConfig({});`)).toMatch(
      /never passes resourceCeiling/,
    );
  });

  it('rejects mergeConfig used without the ceiling import', () => {
    expect(ceilingViolation('export default mergeConfig(somethingElse, x);')).toMatch(
      /never imports/,
    );
  });

  // The first version of this predicate matched raw source, so a config that only TALKED about the
  // ceiling passed — a guard satisfied by a mention instead of a wiring. Found in review, not by
  // the author, which is the usual way that shape gets found.
  it('rejects a config that only mentions the ceiling in comments', () => {
    const source = [
      "import { defineConfig } from 'vitest/config';",
      '// TODO: adopt vitest.shared later',
      'export default defineConfig({});',
      '/* mergeConfig(resourceCeiling, x) would go here */',
    ].join('\n');
    expect(ceilingViolation(source)).toMatch(/does not import/);
  });

  it('rejects a correct-looking config that is entirely commented out', () => {
    const source = [
      "/* import { resourceCeiling } from '../../vitest.shared';",
      '   export default mergeConfig(resourceCeiling, {}); */',
      'export default defineConfig({});',
    ].join('\n');
    expect(ceilingViolation(source)).toMatch(/does not import/);
  });

  // mergeConfig must RECEIVE the ceiling, not merely appear in the file.
  it('rejects mergeConfig that merges something other than the ceiling', () => {
    const source = [
      CEILING_IMPORT,
      'export default mergeConfig(somethingElse, defineConfig({}));',
    ].join('\n');
    expect(ceilingViolation(source)).toMatch(/never passes resourceCeiling/);
  });
});

describe('findVitestConfigs', () => {
  it('finds configs one level into a workspace and at the workspace root', () => {
    const root = scratch();
    writeConfig(root, 'a', 'x');
    writeFileSync(path.join(root, 'packages', 'vitest.config.ts'), 'x');
    const found = findVitestConfigs(root).map((f) => path.relative(root, f));
    expect(found).toContain(path.join('packages', 'a', 'vitest.config.ts'));
    expect(found).toContain(path.join('packages', 'vitest.config.ts'));
  });

  // The depth-1 version of this walk matched `packages/*` and missed `packages/dag-nodes/*`, a real
  // workspace glob holding a real config. The scan reported 31 of 32 and read as complete; the
  // missed package still had V8's 4144 MB default.
  it('finds a config nested deeper than one level', () => {
    const root = scratch();
    const nested = path.join(root, 'packages', 'dag-nodes', 'image-source');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'vitest.config.ts'), 'x');
    const found = findVitestConfigs(root).map((f) => path.relative(root, f));
    expect(found).toContain(path.join('packages', 'dag-nodes', 'image-source', 'vitest.config.ts'));
  });

  it('does not descend into node_modules', () => {
    const root = scratch();
    const nm = path.join(root, 'packages', 'node_modules');
    mkdirSync(nm, { recursive: true });
    writeFileSync(path.join(nm, 'vitest.config.ts'), 'x');
    expect(findVitestConfigs(root)).toHaveLength(0);
  });
});

describe('findCeilingFindings', () => {
  it('is clean when every config inherits the ceiling', () => {
    const root = scratch();
    writeShared(root);
    writeConfig(root, 'a', `${CEILING_IMPORT}\nmergeConfig(resourceCeiling, {});`);
    writeConfig(root, 'b', `${CEILING_IMPORT}\nmergeConfig(resourceCeiling, {});`);
    const r = findCeilingFindings(root);
    expect(r.findings).toEqual([]);
    expect(r.inspected).toBe(2);
  });

  it('names the one config that opted out', () => {
    const root = scratch();
    writeShared(root);
    writeConfig(root, 'a', `${CEILING_IMPORT}\nmergeConfig(resourceCeiling, {});`);
    writeConfig(root, 'b', "import { defineConfig } from 'vitest/config';");
    const r = findCeilingFindings(root);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].file).toContain('b');
  });

  it('reports a missing shared ceiling file', () => {
    const root = scratch();
    writeConfig(root, 'a', `${CEILING_IMPORT}\nmergeConfig(resourceCeiling, {});`);
    const r = findCeilingFindings(root);
    expect(r.sharedPresent).toBe(false);
    expect(r.findings.some((f) => /missing/.test(f.reason))).toBe(true);
  });

  // A walk that inspects nothing must not read as a pass. main() turns this into exit 1 — without
  // it the scan would report success over an empty subject, which is worse than having no scan.
  it('reports an empty subject rather than an implicit pass', () => {
    const root = scratch();
    writeShared(root);
    expect(findCeilingFindings(root).inspected).toBe(0);
  });
});
