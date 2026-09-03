// harness-coverage: harness-coverage-declarations.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findImportSafetyFindings,
  importOutcome,
  untestedScripts,
  weakGuardReason,
} from '../scan-harness-script-import-safety.mjs';

/**
 * HARNESS-065 — the harness scripts spoke two idioms, and the fork was the line between testable and
 * untestable.
 *
 * Counting idioms found the problem; importing every script measured it, and the two disagreed. A
 * source heuristic said zero scripts did work at import. Importing all 126 found TEN — one of which
 * (`lessons-digest.mjs`) regenerated the lessons digest on disk merely by being imported, and one of
 * which (`verify-change.mjs`) ran the entire verification and never returned.
 *
 * The two rules below exist because neither reaches the other's hazard: importing cannot detect a
 * guard that is correct on this machine and silently wrong on a path with a space, and reading the
 * source cannot detect a script that does work through a guard that looks fine.
 */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scriptDir(files) {
  const root = makeTemp('import-safety-');
  dirs.push(root);
  const dir = path.join(root, 'scripts/harness');
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents);
  }
  return root;
}

/** Rule-1 findings only — a throwaway root has no frozen untested baseline, so rule 3 always speaks. */
function importFindings(root) {
  return findImportSafetyFindings(root).findings.filter((f) => f.rule !== 'untested-scripts');
}

const CORRECT_GUARD =
  "if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) { main(); }";

describe('scan-harness-script-import-safety', () => {
  describe('rule 1 — importing must do nothing', () => {
    it('(RED) a script that prints at module scope is a finding', () => {
      const root = scriptDir({ 'noisy.mjs': `console.log('work');` });
      expect(findImportSafetyFindings(root).findings[0]?.reason).toMatch(/wrote output/);
    });

    it('(RED) a script that throws on import is a finding', () => {
      const root = scriptDir({ 'broken.mjs': `throw new Error('nope');` });
      expect(findImportSafetyFindings(root).findings[0]?.reason).toMatch(/exited 1 on import/);
    });

    it('(RED) a script that sets a failing exit code on import is a finding', () => {
      // `scan-release-verification-gate.mjs` ran a whole scan at module scope and ended in
      // `process.exit(1)`, so importing it could terminate the importing process.
      const root = scriptDir({ 'exits.mjs': `process.exit(1);` });
      expect(findImportSafetyFindings(root).findings[0]?.reason).toMatch(/exited 1 on import/);
    });

    it('a guarded script is silent, and is not a finding', () => {
      const root = scriptDir({
        'ok.mjs': [
          `import path from 'node:path';`,
          `function main() { console.log('work'); }`,
          CORRECT_GUARD,
        ].join('\n'),
      });
      // Rule 1 only: a throwaway root has no frozen untested baseline, so rule 3 speaks too. Reading
      // the whole list here would make this case fail for a reason it is not about.
      expect(importFindings(root)).toEqual([]);
    });

    it('a script that exports without running anything is fine', () => {
      const root = scriptDir({ 'lib.mjs': `export function helper() { return 1; }` });
      expect(importFindings(root)).toEqual([]);
    });

    it('reports what a direct import returns, not a guess', () => {
      const outcome = importOutcome(
        (() => {
          const root = scriptDir({ 'p.mjs': `console.log('hello');` });
          return path.join(root, 'scripts/harness/p.mjs');
        })(),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toContain('hello');
    });
  });

  describe('rule 2 — the guard form, which importing cannot reach', () => {
    it('(RED) flags the `file://` comparison', () => {
      // MEASURED: a probe using this form, under a directory named `dir with space`, printed nothing
      // and exited 0 — `main()` never ran. On an ordinary path it behaves correctly, which is why
      // rule 1 passes it and only a source rule can catch it.
      expect(
        weakGuardReason('if (import.meta.url === `file://${process.argv[1]}`) { main(); }'),
      ).toMatch(/fails toward silence/);
    });

    it('(RED) flags `pathToFileURL(process.argv[1])`', () => {
      expect(
        weakGuardReason('if (import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }'),
      ).toMatch(/THROWS/);
    });

    it('accepts the resolve form', () => {
      expect(weakGuardReason(CORRECT_GUARD)).toBeUndefined();
    });

    it('does not flag the banned forms NAMED in a comment', () => {
      // A scan must be able to name what it forbids. Without this, this scan reported itself for its
      // own docstring — and then again for its own error message.
      expect(weakGuardReason('// never write import.meta.url === `file://${x}`')).toBeUndefined();
      expect(
        weakGuardReason('/**\n * avoid pathToFileURL(process.argv[1]) here\n */'),
      ).toBeUndefined();
    });

    it('does not flag the banned forms NAMED in a string', () => {
      expect(
        weakGuardReason(`throw new Error("do not use pathToFileURL(process.argv[1])");`),
      ).toBeUndefined();
    });
  });

  describe('rule 3 — the untested count, which the other two make possible', () => {
    it('lists a script with no test file', () => {
      const root = scriptDir({ 'lonely.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      expect(untestedScripts(dir, ['lonely.mjs'])).toEqual(['lonely.mjs']);
    });

    it('a script IS covered by a test named after it', () => {
      const root = scriptDir({ 'covered.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(path.join(dir, '__tests__/covered.test.mjs'), '');
      expect(untestedScripts(dir, ['covered.mjs'])).toEqual([]);
    });

    it('(RED) does not credit a coverage comment without a static module reference', () => {
      const root = scriptDir({ 'work-run-cli.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/facade.test.mjs'),
        '// harness-coverage: work-run-cli.mjs\nit("covers the CLI through its facade", () => {});\n',
      );
      expect(() => untestedScripts(dir, ['work-run-cli.mjs'])).toThrow(/static import path/i);
    });

    it('(RED) credits a declaration reached through the test static import graph', () => {
      const root = scriptDir({
        'facade.mjs': "export { x } from './work-run-cli.mjs';",
        'work-run-cli.mjs': 'export const x = 1;',
      });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/facade.test.mjs'),
        [
          '// harness-coverage: work-run-cli.mjs',
          "import { x } from '../facade.mjs';",
          'it("covers the CLI through its facade", () => x);',
        ].join('\n'),
      );
      expect(untestedScripts(dir, ['facade.mjs', 'work-run-cli.mjs'])).toEqual([]);
    });

    it('credits helpers reached through a tested facade without debt declarations', () => {
      const root = scriptDir({
        'facade.mjs': "export { x } from './helper.mjs';",
        'helper.mjs': 'export const x = 1;',
      });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/facade.test.mjs'),
        "import { x } from '../facade.mjs';\nit('exercises the facade', () => x);\n",
      );
      expect(untestedScripts(dir, ['facade.mjs', 'helper.mjs'])).toEqual([]);
    });

    it('credits helpers imported by a dedicated module-boundary test', () => {
      const root = scriptDir({
        'facade.mjs': "export { x } from './helper.mjs';",
        'helper.mjs': 'export const x = 1;',
      });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/module-boundaries.test.mjs'),
        [
          "import * as facade from '../facade.mjs';",
          "import * as helper from '../helper.mjs';",
          "it('preserves identities', () => facade.x === helper.x);",
        ].join('\n'),
      );
      expect(untestedScripts(dir, ['facade.mjs', 'helper.mjs'])).toEqual([]);
    });

    it('does not credit an unimported helper beside a tested facade', () => {
      const root = scriptDir({
        'facade.mjs': 'export const x = 1;',
        'helper.mjs': 'export const y = 2;',
      });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/facade.test.mjs'),
        "import { x } from '../facade.mjs';\nit('exercises the facade', () => x);\n",
      );
      expect(untestedScripts(dir, ['facade.mjs', 'helper.mjs'])).toEqual(['helper.mjs']);
    });

    it('(RED) rejects unknown and non-top-level declaration targets', () => {
      const root = scriptDir({ 'known.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      const testDir = path.join(dir, '__tests__');
      mkdirSync(path.join(dir, 'lib'), { recursive: true });
      mkdirSync(testDir, { recursive: true });
      writeFileSync(path.join(dir, 'lib/nested.mjs'), 'export const nested = 1;');

      writeFileSync(
        path.join(testDir, 'unknown.test.mjs'),
        "// harness-coverage: missing.mjs\nimport '../known.mjs';\n",
      );
      expect(() => untestedScripts(dir, ['known.mjs'])).toThrow(/does not exist/i);

      rmSync(path.join(testDir, 'unknown.test.mjs'));
      writeFileSync(
        path.join(testDir, 'nested.test.mjs'),
        "// harness-coverage: lib/nested.mjs\nimport '../lib/nested.mjs';\n",
      );
      expect(() => untestedScripts(dir, ['known.mjs', 'lib/nested.mjs'])).toThrow(/top-level/i);
    });

    it('(RED) rejects duplicate declarations within or across tests', () => {
      const root = scriptDir({ 'shared.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      const testDir = path.join(dir, '__tests__');
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        path.join(testDir, 'one.test.mjs'),
        [
          '// harness-coverage: shared.mjs',
          '// harness-coverage: shared.mjs',
          "import '../shared.mjs';",
        ].join('\n'),
      );
      expect(() => untestedScripts(dir, ['shared.mjs'])).toThrow(/duplicate/i);

      writeFileSync(
        path.join(testDir, 'one.test.mjs'),
        "// harness-coverage: shared.mjs\nimport '../shared.mjs';\n",
      );
      writeFileSync(
        path.join(testDir, 'two.test.mjs'),
        "// harness-coverage: shared.mjs\nimport '../shared.mjs';\n",
      );
      expect(() => untestedScripts(dir, ['shared.mjs'])).toThrow(/duplicate/i);
    });

    it('(RED) rejects malformed coverage declarations', () => {
      const root = scriptDir({ 'known.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/known.test.mjs'),
        "// harness-coverage:known.mjs\nimport '../known.mjs';\n",
      );
      expect(() => untestedScripts(dir, ['known.mjs'])).toThrow(/malformed/i);
    });

    it('(RED) reports an invalid declaration as a scan finding', () => {
      const root = scriptDir({ 'known.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(
        path.join(dir, '__tests__/known.test.mjs'),
        "// harness-coverage:missing.mjs\nimport '../known.mjs';\n",
      );
      expect(findImportSafetyFindings(root).findings).toContainEqual(
        expect.objectContaining({ rule: 'invalid-coverage-declaration' }),
      );
    });

    it('does not credit a test whose name merely STARTS with the script name', () => {
      // `scan-foo.mjs` must not be covered by `scan-foo-bar.test.mjs`; the separator is what makes
      // the match a name rather than a prefix.
      const root = scriptDir({ 'scan-foo.mjs': 'export const x = 1;' });
      const dir = path.join(root, 'scripts/harness');
      mkdirSync(path.join(dir, '__tests__'), { recursive: true });
      writeFileSync(path.join(dir, '__tests__/scan-foo-bar.test.mjs'), '');
      expect(untestedScripts(dir, ['scan-foo.mjs'])).toEqual(['scan-foo.mjs']);
    });

    it('counts every script as untested when there is no test directory at all', () => {
      const root = scriptDir({ 'a.mjs': 'export const x = 1;' });
      expect(untestedScripts(path.join(root, 'scripts/harness'), ['a.mjs'])).toEqual(['a.mjs']);
    });
  });

  describe('fail-closed', () => {
    it('throws when the script directory is absent', () => {
      const root = makeTemp('import-safety-bare-');
      dirs.push(root);
      expect(() => findImportSafetyFindings(root)).toThrow(/does not exist/);
    });

    it('throws when the directory holds no scripts', () => {
      const root = scriptDir({});
      expect(() => findImportSafetyFindings(root)).toThrow(/no \.mjs scripts/);
    });
  });

  it('imports scripts in SUBDIRECTORIES too', () => {
    // `scripts/harness/lib/` holds three shared modules a top-level read left outside this floor.
    // A module under `lib/` can run work on import exactly as one above it can.
    const { root, dir } = (() => {
      const r = scriptDir({ 'top.mjs': 'export const x = 1;' });
      return { root: r, dir: path.join(r, 'scripts/harness') };
    })();
    mkdirSync(path.join(dir, 'lib'), { recursive: true });
    writeFileSync(path.join(dir, 'lib/noisy.mjs'), `console.log('work');`);
    expect(importFindings(root)[0]?.script).toBe('lib/noisy.mjs');
  });

  it('a nested script is covered by a test named after its BASENAME', () => {
    // `lib/ts-ast.mjs` is covered by `__tests__/ts-ast.test.mjs`; making the walk recursive must not
    // silently reclassify already-covered modules as untested.
    const root = scriptDir({});
    const dir = path.join(root, 'scripts/harness');
    mkdirSync(path.join(dir, 'lib'), { recursive: true });
    mkdirSync(path.join(dir, '__tests__'), { recursive: true });
    writeFileSync(path.join(dir, 'lib/thing.mjs'), 'export const x = 1;');
    writeFileSync(path.join(dir, '__tests__/thing.test.mjs'), '');
    expect(untestedScripts(dir, ['lib/thing.mjs'])).toEqual([]);
  });

  it('is registered and passes on the live repository', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-harness-script-import-safety.mjs',
    );

    const { findings, examined } = findImportSafetyFindings(root);
    expect(findings).toEqual([]);
    // A pass over nothing is not a pass — and this number is the whole harness.
    expect(examined).toBeGreaterThan(100);
    // Imports every harness script in a subprocess; the whole tree takes ~10s on a loaded machine.
  }, 60_000);
});
