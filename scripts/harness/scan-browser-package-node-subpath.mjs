#!/usr/bin/env node

/**
 * CORE-028 — a package that declares a `browser` build must not import a Node-only subpath.
 *
 * ## What this closes
 *
 * The Node-only surface moved to `@robota-sdk/agent-core/node`, and that subpath carries
 * `"browser": null` so a spec-compliant resolver refuses it by name. Review pointed out the gap that
 * leaves: the repository's own bundler does NOT stop at the null for a workspace-linked consumer —
 * it resolves the `source` condition and then fails on the Node builtins. The build still breaks, but
 * with a message about `node:fs` rather than about the import that asked for it.
 *
 * No package does this today. Nothing stopped the next one, and "nothing stopped it" is the state
 * this repository treats as the defect rather than the near miss.
 *
 * ## What it checks
 *
 * For every package whose `package.json` declares a `browser` export condition, no file under `src/`
 * may import a `/node` subpath of a workspace package. The check is on the DECLARATION, not on how
 * any particular bundler behaves — a package promising a browser build is promising a graph a browser
 * can load, whatever resolver a consumer happens to use.
 *
 * A package that legitimately ships both surfaces states it in its `docs/SPEC.md`, NAMING the file:
 *
 *   browser-node-subpath: allowed — `src/thing.ts` imports it, and <why it cannot reach the browser build>
 *
 * The name is what bounds the exemption, and it is read from the declaration LINE. Two versions
 * were wider than the thing they excused, and review found both:
 *
 *   per PACKAGE   the phrase switched the check off for the whole `src/` tree the moment it
 *                 appeared anywhere in the SPEC
 *   per DOCUMENT  the names were then read from the whole file, so every backticked `src/…` path in
 *                 it was excused — in `agent-tools` that is eight test files and three other
 *                 builtins the declaration is not about
 *
 * An escape hatch that grows with the length of a document is not an exemption, it is an off switch
 * with a delay. A declaration naming no file excuses nothing.
 *
 * ## Which way its enumeration fails
 *
 * allow-missing-artifact-file: this file documents and exercises a DECLARATION FORMAT, so the
 * paths inside its examples and fixtures (`src/thing.ts`, `src/excused.ts`, the fixture tree
 * under a temp dir) are deliberately fictional. Naming a real file in an example would make
 * the example wrong the moment that file moved.
 *
 * fail-direction: refuse — the subject list is every package DECLARING a browser condition, read
 * from the manifests rather than from a maintained list, so a new one is in scope the moment it
 * exists. A root with no packages throws rather than reporting a clean pass: nothing-examined must
 * not read as nothing-wrong.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { loadHarnessConfig } from './harness-config.mjs';
import { listSourceFiles, listWorkspacePackageDirs } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const GOVERNED_TREE = 'packages';
/** How a package that ships both surfaces declares it. */
const DECLARATION = /browser-node-subpath:\s*allowed\s*[—-]\s*\S/;
/** A package-relative source path named inside the declaration, in backticks. */
const DECLARED_PATH = /`(src\/[^`\s]+)`/g;

/**
 * The source files a SPEC's declaration excuses, package-relative.
 *
 * Read from THE DECLARATION LINE, not from the document. The first version searched the whole
 * SPEC.md once the phrase appeared anywhere, and review measured what that excuses: every backticked
 * `src/…` path in the file — in `agent-tools` that is eight test files and three other builtins, none
 * of which the declaration is about. An escape hatch that grows with the length of a document is
 * not an exemption, it is an off switch with a delay.
 *
 * The declaration must NAME its files, on its own line. One naming none excuses none —
 * deliberately, and fail-closed. Naming the file is also what makes the reason checkable, since the
 * reason is always about a specific import.
 */
function declaredFiles(specText) {
  const declaration = specText.split(/\r?\n/).find((line) => DECLARATION.test(line));
  if (declaration === undefined) return [];
  DECLARED_PATH.lastIndex = 0;
  return [...declaration.matchAll(DECLARED_PATH)].map((match) => match[1]);
}

/**
 * Does this manifest promise a browser build?
 *
 * A `browser` condition that RESOLVES to something. `"browser": null` is the opposite claim — it is
 * how a Node-only subpath tells a resolver to refuse it by name, and it is the convention this very
 * scan was written alongside: `agent-core`'s `./node` carries one.
 *
 * The first version asked `JSON.stringify(exports).includes('"browser"')`, which matches the null
 * marker as readily as a real target. Review found it before it fired: no package trips it today
 * because every package declaring `"browser": null` also declares a real browser entry at `.`, but
 * the next Node-only package to adopt the convention with no browser build would have been read as
 * a browser package and then asked to justify its ordinary Node imports in SPEC.md. A check that
 * fires on correct work is one that gets turned off — and this one would have been taught to fire
 * by the pattern it exists to protect.
 */
function declaresBrowser(manifest) {
  return hasLiveBrowserCondition(manifest.exports) || isLiveTarget(manifest.browser);
}

/** A condition target that actually resolves — not `null`, and not an empty map. */
function isLiveTarget(target) {
  if (target === null || target === undefined) return false;
  if (typeof target === 'string') return target !== '';
  if (Array.isArray(target)) return target.some(isLiveTarget);
  if (typeof target === 'object') return Object.values(target).some(isLiveTarget);
  return false;
}

/** Any `browser` key anywhere in the exports tree whose target resolves. */
function hasLiveBrowserCondition(node) {
  if (node === null || node === undefined || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasLiveBrowserCondition);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'browser' && isLiveTarget(value)) return true;
    if (hasLiveBrowserCondition(value)) return true;
  }
  return false;
}

export function browserPackages(root = WORKSPACE_ROOT) {
  // The workspace's OWN lister, not a hand-rolled walk. The first version read `packages/*` one
  // level deep, so `packages/dag-nodes/*` and every app were outside its subject list — a check that
  // silently did not look at half the tree. Review found it. `pnpm-workspace.yaml` declares the
  // layout and this function is where the harness reads it.
  return listWorkspacePackageDirs(root)
    .filter((dir) => existsSync(path.join(dir, 'package.json')))
    .filter((dir) => {
      try {
        return declaresBrowser(JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')));
      } catch {
        // An unreadable manifest is not a package that passed — it is one that could not be judged,
        // and the caller below turns an empty subject list into a failure for exactly that reason.
        return false;
      }
    });
}

export function findBrowserNodeSubpathFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, GOVERNED_TREE, {
    scan: 'browser-package-node-subpath',
    why: 'the packages it judges live there, so its subject list would be empty rather than clean.',
  });
  const scope = loadHarnessConfig().npmScopePrefix;
  // `from '@scope/anything/node'` — the workspace's Node-only subpath convention.
  const nodeSubpath = new RegExp(`['"]${scope.replace(/[/\\-]/g, '\\$&')}[^'"]+/node['"]`);

  const findings = [];
  for (const packageDir of browserPackages(root)) {
    const spec = path.join(packageDir, 'docs', 'SPEC.md');
    const excused = existsSync(spec) ? declaredFiles(readFileSync(spec, 'utf8')) : [];
    for (const file of listSourceFiles(path.join(packageDir, 'src'))) {
      const text = readFileSync(file, 'utf8');
      if (!nodeSubpath.test(text)) continue;
      // The exemption covers the FILES the declaration names, not the package it sits in. Review
      // found the first version skipping the rest of the package's `src/` the moment the phrase
      // appeared anywhere in SPEC.md — so `agent-tools`, which justifies exactly one import site,
      // would have silently covered any other `/node` import added anywhere else in it later.
      //
      // That is the same "nothing stopped the next one" this scan exists to answer, reintroduced by
      // its own escape hatch. An escape hatch wider than the thing it excuses is a hole.
      const relative = path.relative(packageDir, file).split(path.sep).join('/');
      if (excused.includes(relative)) continue;
      findings.push({ file: path.relative(root, file) });
    }
  }
  return findings;
}

function main() {
  const packages = browserPackages();
  const findings = findBrowserNodeSubpathFindings();
  console.log(`::examined:: ${packages.length} package(s) declaring a browser build`);
  if (packages.length === 0) {
    console.error(
      'browser-package-node-subpath scan FAILED — no package declares a browser build. Either the ' +
        'layout moved or this scan is looking in the wrong place; it does not report a pass over ' +
        'nothing.',
    );
    process.exit(1);
  }
  if (findings.length === 0) {
    console.log('browser-package-node-subpath scan passed.');
    process.exit(0);
  }
  console.error(
    'browser-package-node-subpath scan FAILED — a browser build imports a Node subpath:',
  );
  for (const finding of findings) console.error(`  ${finding.file}`);
  console.error(
    '\nCORE-028: a package promising a browser build is promising a graph a browser can load.\n' +
      '  - Move the import behind a Node-only entry point, or\n' +
      '  - if this import genuinely cannot reach the browser build, say so in docs/SPEC.md and\n' +
      '    NAME the file — the declaration excuses the files it names, and nothing else:\n' +
      '      browser-node-subpath: allowed — `src/thing.ts` imports it, and <why>\n' +
      '  The subpath carries `"browser": null`, but a resolver that ignores it fails on the Node\n' +
      '  builtins instead — a message about `node:fs` rather than about the import that asked.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
