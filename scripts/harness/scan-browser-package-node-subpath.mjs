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
 * A package that legitimately ships both surfaces states it:
 *
 *   browser-node-subpath: allowed — <why this import cannot reach the browser build>
 *
 * in its `docs/SPEC.md`.
 *
 * ## Which way its enumeration fails
 *
 * fail-direction: refuse — the subject list is every package DECLARING a browser condition, read
 * from the manifests rather than from a maintained list, so a new one is in scope the moment it
 * exists. A root with no packages throws rather than reporting a clean pass: nothing-examined must
 * not read as nothing-wrong.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const GOVERNED_TREE = 'packages';
/** How a package that ships both surfaces declares it. */
const DECLARATION = /browser-node-subpath:\s*allowed\s*[—-]\s*\S/;

/** Does this manifest promise a browser build? */
function declaresBrowser(manifest) {
  const seen = JSON.stringify(manifest.exports ?? {});
  return seen.includes('"browser"') || manifest.browser !== undefined;
}

/** Every non-test source file under a package. */
function sourceFiles(packageDir) {
  const root = path.join(packageDir, 'src');
  if (!existsSync(root)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue;
        walk(full);
        continue;
      }
      if (/\.(ts|tsx|mts|js|mjs)$/.test(entry) && !entry.includes('.test.')) found.push(full);
    }
  };
  walk(root);
  return found;
}

export function browserPackages(root = WORKSPACE_ROOT) {
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .map((name) => path.join(packagesDir, name))
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
    if (existsSync(spec) && DECLARATION.test(readFileSync(spec, 'utf8'))) continue;
    for (const file of sourceFiles(packageDir)) {
      const text = readFileSync(file, 'utf8');
      if (!nodeSubpath.test(text)) continue;
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
      '  - if this import genuinely cannot reach the browser build, say so in docs/SPEC.md:\n' +
      '      browser-node-subpath: allowed — <why>\n' +
      '  The subpath carries `"browser": null`, but a resolver that ignores it fails on the Node\n' +
      '  builtins instead — a message about `node:fs` rather than about the import that asked.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
