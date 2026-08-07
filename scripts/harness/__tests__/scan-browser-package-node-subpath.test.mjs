/**
 * CORE-028 — a package promising a browser build must not import a Node-only subpath.
 *
 * The `./node` subpath carries `"browser": null`, so a spec-compliant resolver refuses it by name.
 * Review pointed out what that leaves open: this repository's own bundler does not stop at the null
 * for a workspace-linked consumer — it resolves `source` and then fails on the Node builtins, with a
 * message about `node:fs` rather than about the import that asked for it.
 *
 * No package did this. Nothing stopped the next one, and "nothing stopped it" is the state this
 * repository treats as the defect rather than the near miss.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  browserPackages,
  findBrowserNodeSubpathFindings,
} from '../scan-browser-package-node-subpath.mjs';

let root;
const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/**
 * A package with the given manifest exports and one source file.
 *
 * `name` may carry a directory — `dag-nodes/file-read` — because the workspace declares packages at
 * two depths. The first version of this scan read `packages/*` one level deep and so never looked at
 * the nested family or at apps; the cases below cover both, since a check that does not look is
 * indistinguishable from one that found nothing.
 */
function makePackage(name, { exports, source, spec, family = 'packages' } = {}) {
  const dir = path.join(root, family, name);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, exports: exports ?? {} }));
  writeFileSync(path.join(dir, 'src', 'index.ts'), source ?? '// nothing\n');
  if (spec !== undefined) {
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'SPEC.md'), spec);
  }
}

const BROWSER_EXPORTS = { '.': { browser: { import: './dist/browser/index.js' } } };
const NODE_ONLY_EXPORTS = { '.': { node: { import: './dist/node/index.js' } } };
const IMPORTS_NODE_SUBPATH = "import { isPathInside } from '@robota-sdk/agent-core/node';\n";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'browser-subpath-'));
  scratch.push(root);
  mkdirSync(path.join(root, 'packages'), { recursive: true });
});

describe('a package that promises a browser build', () => {
  it('is reported when it imports a Node-only subpath', () => {
    makePackage('agent-thing', { exports: BROWSER_EXPORTS, source: IMPORTS_NODE_SUBPATH });

    expect(findBrowserNodeSubpathFindings(root).map((f) => f.file)).toEqual([
      path.join('packages', 'agent-thing', 'src', 'index.ts'),
    ]);
  });

  it('is left alone when it declares the exception, with a reason', () => {
    makePackage('agent-thing', {
      exports: BROWSER_EXPORTS,
      source: IMPORTS_NODE_SUBPATH,
      spec: '# Thing\n\nbrowser-node-subpath: allowed — the browser entry is a separate graph.\n',
    });

    expect(findBrowserNodeSubpathFindings(root)).toEqual([]);
  });

  it('is NOT excused by a declaration with no reason', () => {
    // Otherwise the escape hatch is a phrase rather than a decision, which is the state the whole
    // check exists to remove.
    makePackage('agent-thing', {
      exports: BROWSER_EXPORTS,
      source: IMPORTS_NODE_SUBPATH,
      spec: '# Thing\n\nbrowser-node-subpath: allowed\n',
    });

    expect(findBrowserNodeSubpathFindings(root)).toHaveLength(1);
  });
});

describe('what the check considers its subject', () => {
  it('ignores a package with no browser build', () => {
    // A Node-only package importing a Node subpath is the ordinary case. Reporting it would be the
    // check firing on correct work, which is what gets a check turned off.
    makePackage('agent-thing', { exports: NODE_ONLY_EXPORTS, source: IMPORTS_NODE_SUBPATH });

    expect(browserPackages(root)).toEqual([]);
    expect(findBrowserNodeSubpathFindings(root)).toEqual([]);
  });

  it('sees a package NESTED one level deeper', () => {
    // `packages/dag-nodes/*` is declared in pnpm-workspace.yaml, and the flat read missed all of it.
    makePackage('dag-nodes/file-read', {
      exports: BROWSER_EXPORTS,
      source: IMPORTS_NODE_SUBPATH,
    });

    expect(findBrowserNodeSubpathFindings(root)).toHaveLength(1);
  });

  it('sees an app', () => {
    makePackage('agent-app', {
      exports: BROWSER_EXPORTS,
      source: IMPORTS_NODE_SUBPATH,
      family: 'apps',
    });

    expect(findBrowserNodeSubpathFindings(root)).toHaveLength(1);
  });

  it('does NOT read a `"browser": null` marker as a browser build', () => {
    // The false-positive trap this PR's own convention would have set. `"browser": null` is how a
    // Node-only subpath tells a resolver to refuse it BY NAME — the opposite of promising a browser
    // build — and the first version of this check asked
    // `JSON.stringify(exports).includes('"browser"')`, which matches the marker as readily as a
    // real target.
    //
    // No package trips it today, because every package carrying the marker also declares a real
    // browser entry at `.`. The next Node-only package to adopt the convention would have been read
    // as a browser package and then asked to justify its ordinary Node imports. A check that fires
    // on correct work is one that gets turned off.
    makePackage('agent-thing', {
      exports: {
        '.': { node: { import: './dist/node/index.js' } },
        './node': { node: { import: './dist/node/node.js' }, browser: null },
      },
      source: IMPORTS_NODE_SUBPATH,
    });

    expect(browserPackages(root)).toEqual([]);
    expect(findBrowserNodeSubpathFindings(root)).toEqual([]);
  });

  it('still sees a browser build declared BESIDE a `"browser": null` marker', () => {
    // The shape `agent-core` actually has, and the reason the fix is "a condition that RESOLVES"
    // rather than "no null anywhere": a package may legitimately promise a browser build at `.` and
    // refuse one for its `/node` subpath, and that package IS in scope.
    makePackage('agent-thing', {
      exports: {
        '.': { browser: { import: './dist/browser/index.js' } },
        './node': { node: { import: './dist/node/node.js' }, browser: null },
      },
      source: IMPORTS_NODE_SUBPATH,
    });

    expect(findBrowserNodeSubpathFindings(root)).toHaveLength(1);
  });

  it('reads a top-level `browser` field, and not a null one', () => {
    // The other half of `declaresBrowser`, which the same substring reading covered by accident.
    makePackage('with-field', { exports: {}, source: IMPORTS_NODE_SUBPATH });
    writeFileSync(
      path.join(root, 'packages', 'with-field', 'package.json'),
      JSON.stringify({ name: 'with-field', browser: './dist/browser/index.js' }),
    );
    makePackage('with-null-field', { exports: {}, source: IMPORTS_NODE_SUBPATH });
    writeFileSync(
      path.join(root, 'packages', 'with-null-field', 'package.json'),
      JSON.stringify({ name: 'with-null-field', browser: null }),
    );

    expect(findBrowserNodeSubpathFindings(root).map((f) => f.file)).toEqual([
      path.join('packages', 'with-field', 'src', 'index.ts'),
    ]);
  });

  it('REFUSES a root with no packages tree rather than reporting it clean', () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'browser-subpath-bare-'));
    scratch.push(bare);

    expect(() => findBrowserNodeSubpathFindings(bare)).toThrow(/packages missing from/);
  });
});
