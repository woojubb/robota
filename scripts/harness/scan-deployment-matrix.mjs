#!/usr/bin/env node

/**
 * SELFHOST-013 — keeps the Deployment Matrix (.agents/specs/deployment-matrix.md) current.
 *
 * The matrix is the single at-a-glance registry of surface × runtime × transport for the "one agent definition
 * → many channels" story. For it to stay trustworthy, every transport `name` must have a row. Transport names
 * live in CODE, so the enumerable source is the set of `IConfigurableTransport`/`ITransportAdapter` adapters that
 * declare a `name` — verified today as exactly `{tui, ws, webrtc, http, mcp}`. This scan enumerates them from the
 * code and FAILs when a transport `name` is missing a matrix row (undocumented) or a matrix Transport-`name` row
 * names a nonexistent transport (phantom).
 *
 * A transport declares its `name` in one of two forms, both parsed here:
 *   - class form:   `readonly name = 'ws'`      (tui / ws / webrtc)
 *   - factory form: `name: 'http'`              (http / mcp / ws)
 *
 * EXCLUDED (export no transport `name`): `agent-transport-protocol` (shared lib) + `agent-transport-gui` /
 * `agent-transport-webrtc-web` (React/browser presentation). Scope is transport packages' `*transport*.ts` files.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const MATRIX = path.join(WORKSPACE_ROOT, '.agents/specs/deployment-matrix.md');

/** Transport packages that export NO transport `name` (shared protocol lib + React/browser presentation). */
const EXCLUDED_PACKAGES = new Set([
  'agent-transport-protocol',
  'agent-transport-gui',
  'agent-transport-webrtc-web',
]);

const CLASS_NAME_RE = /\breadonly\s+name\s*=\s*'([a-z][\w-]*)'/g;
const FACTORY_NAME_RE = /\bname:\s*'([a-z][\w-]*)'/g;

/** Recursively collect `*transport*.ts` non-test files under a dir. */
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

/** Enumerate the transport `name` set declared across the transport packages (both declaration forms). */
export function findTransportNames(root = WORKSPACE_ROOT) {
  const names = new Set();
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return names;
  for (const pkg of readdirSync(packagesDir)) {
    if (!pkg.startsWith('agent-transport-') || EXCLUDED_PACKAGES.has(pkg)) continue;
    const srcDir = path.join(packagesDir, pkg, 'src');
    if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) continue;
    for (const file of transportSourceFiles(srcDir)) {
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
  // Rows look like: | Surface | Runtime | `ws` (nonce auth) | `agent-transport-gui` | … |
  // The Transport-`name` column is the 3rd cell; extract backtick tokens that are bare transport names.
  for (const line of matrixText.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    // Skip the separator row (|---|---|…) and the header row (Surface | Runtime | Transport `name` | …).
    if (/^[\s|:-]+$/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells[1] === 'Surface') continue; // header
    // cells[0] is '' (leading pipe); the Transport-`name` column is index 3 (Surface=1, Runtime=2, Transport=3).
    const transportCell = cells[3];
    if (!transportCell) continue;
    for (const m of transportCell.matchAll(/`([a-z][\w-]*)`/g)) {
      // Skip the literal column header `name` and any client/presentation package tokens.
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
