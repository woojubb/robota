#!/usr/bin/env node

/**
 * SELFHOST-013 — keeps the Deployment Matrix (.agents/specs/deployment-matrix.md) current.
 *
 * The matrix is the single at-a-glance registry of surface × runtime × transport for the "one agent definition
 * → many channels" story. For it to stay trustworthy, every transport `name` must have a row. Transport names
 * live in CODE, so the enumerable source is the set of `IConfigurableTransport`/`ITransportAdapter` adapters that
 * declare a `name` — verified today as exactly `{headless, ws, webrtc, http, mcp}`. This scan enumerates them from the
 * code and FAILs when a transport `name` is missing a matrix row (undocumented) or a matrix Transport-`name` row
 * names a nonexistent transport (phantom).
 *
 * A transport declares its `name` in one of two forms, both parsed here:
 *   - class form:   `readonly name = 'ws'`      (tui / ws / webrtc)
 *   - factory form: `name: 'http'`              (http / mcp / ws)
 *
 * EXCLUDED (export no transport `name`): `agent-transport-protocol` (shared lib) + `agent-transport-gui` /
 * `agent-transport-webrtc-web` (React/browser presentation). Scope is transport packages and framework's
 * `src/transport-host`, restricted to `*transport*.ts` files.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const MATRIX = path.join(WORKSPACE_ROOT, '.agents/specs/deployment-matrix.md');

/** Transport packages that export NO transport `name` (shared protocol lib + React/browser presentation). */
const EXCLUDED_PACKAGES = new Set([
  'agent-transport-protocol',
  'agent-transport-gui',
  'agent-transport-webrtc-web',
]);

// A transport declares its `name` as a class field (`readonly name = 'ws'`, optionally typed
// `readonly name: TName = 'ws'`) or a factory object-literal (`name: 'http'`).
const CLASS_NAME_RE = /\breadonly\s+name\s*(?::\s*[\w.<>[\]| ]+)?\s*=\s*'([a-z][\w-]*)'/g;
const FACTORY_NAME_RE = /\bname:\s*'([a-z][\w-]*)'/g;

/**
 * Recursively collect non-test `*transport*.ts` source files under a dir. Scoping to transport-named files (the
 * established convention — every transport declares its `name` in a `*-transport.ts` file) keeps the generic
 * factory `name: '…'` form from matching unrelated object literals (e.g. a message `name: 'submit'`). A new
 * transport MUST live in a `*-transport.ts` file to be enumerated by this floor.
 */
function transportSourceFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...transportSourceFiles(full));
    } else if (
      /transport/i.test(entry.name) &&
      /\.ts$/.test(entry.name) &&
      !/\.(test|spec)\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Enumerate the transport `name` set declared across the transport packages (both declaration forms).
 *
 * HARNESS-052 sub-shape A: this scan's stated subject is "the adapters that declare a `name`", and
 * what it actually matched was a directory-name PREFIX. `agent-transport-` (with the hyphen)
 * excluded `packages/agent-transport` itself, so `createHeadlessTransport`'s `name: 'headless'` —
 * the factory form this scan exists to parse — could never contribute, and the matrix went on
 * asserting the set was "exactly {tui, ws, webrtc, http, mcp}". Measured, not reasoned: including
 * the base package discovers `headless` and nothing else.
 *
 * The `*transport*.ts` filename filter STAYS. Measured too: dropping it also matches
 * `name: 'robota-agent'` and `name: 'submit'` in `mcp-server.ts` — unrelated object literals that
 * would turn this floor into three phantom findings per run, and a floor people route around
 * catches less than one that fires narrowly.
 */
/**
 * How many transport source files the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases (HARNESS-057). RESET at the top of the walk, so a run that reads nothing cannot report the
 * previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export function findTransportNames(root = WORKSPACE_ROOT) {
  examinedCount = 0;
  requireGovernedTree(root, ['packages'], {
    scan: 'deployment-matrix',
    why: 'Transport names are enumerated FROM the package tree; over an absent one the matrix would read as entirely phantom or entirely complete depending on the caller, neither of which is a measurement.',
  });
  const names = new Set();
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return names;
  for (const pkg of readdirSync(packagesDir)) {
    if (
      (pkg !== 'agent-framework' && !/^agent-transport(-|$)/.test(pkg)) ||
      EXCLUDED_PACKAGES.has(pkg)
    )
      continue;
    const srcDir = path.join(
      packagesDir,
      pkg,
      'src',
      ...(pkg === 'agent-framework' ? ['transport-host'] : []),
    );
    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) continue;
    for (const file of transportSourceFiles(srcDir)) {
      examinedCount += 1;
      const text = readFileSync(file, 'utf8');
      for (const re of [CLASS_NAME_RE, FACTORY_NAME_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) names.add(m[1]);
      }
    }
  }
  return names;
}

/** Parse the backtick-quoted transport `name`s from the matrix's Transport-`name` column. */
export function findMatrixNames(matrixText) {
  const names = new Set();
  // Locate the Transport-`name` column by its HEADER (robust to added/reordered columns), then read that cell
  // from every data row. Rows look like: | Surface | Runtime | `ws` (nonce auth) | `agent-transport-gui` | … |.
  let transportCol = -1;
  for (const line of matrixText.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    if (/^[\s|:-]+$/.test(line)) continue; // separator row
    const cells = line.split('|').map((c) => c.trim());
    if (transportCol === -1) {
      // The first table row is the header; find the cell naming the Transport column.
      transportCol = cells.findIndex((c) => /^Transport\b/.test(c));
      continue; // header row carries no data
    }
    const transportCell = cells[transportCol];
    if (!transportCell) continue;
    for (const m of transportCell.matchAll(/`([a-z][\w-]*)`/g)) {
      // Skip the literal column header token and any client/presentation package names.
      if (m[1] !== 'name' && !m[1].startsWith('agent-')) names.add(m[1]);
    }
  }
  return names;
}

/** Pure diff (exposed for tests): { undocumented, phantom }. */
export function diffDeploymentMatrix(codeNames, matrixNames) {
  const undocumented = [...codeNames].filter((n) => !matrixNames.has(n));
  const phantom = [...matrixNames].filter((n) => !codeNames.has(n));
  return { undocumented, phantom };
}

function main() {
  if (!existsSync(MATRIX)) {
    console.error('deployment-matrix scan: .agents/specs/deployment-matrix.md is missing.');
    process.exit(1);
  }
  const codeNames = findTransportNames();
  const matrixNames = findMatrixNames(readFileSync(MATRIX, 'utf8'));
  const { undocumented, phantom } = diffDeploymentMatrix(codeNames, matrixNames);

  // Before the branch. The runner reads this marker out of EVERY run, pass or fail, toward the
  // frozen adoption count — so a marker only the passing arm reaches makes a legitimate failure
  // ALSO report a fallen adoption, which is a second, false finding riding on the first.
  console.log(`::examined:: ${examinedCount} transport source files`);

  if (undocumented.length === 0 && phantom.length === 0) {
    console.log(`deployment-matrix scan passed (${[...codeNames].sort().join(', ')}).`);
    process.exit(0);
  }
  console.error('deployment-matrix scan: FINDINGS');
  for (const n of undocumented) {
    console.error(
      `  - transport "${n}" is declared in code but missing a Deployment Matrix row (undocumented).`,
    );
  }
  for (const n of phantom) {
    console.error(
      `  - Deployment Matrix names transport "${n}" but no such transport is declared in code (phantom).`,
    );
  }
  console.error('\nFix: update .agents/specs/deployment-matrix.md in the same change.');
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
