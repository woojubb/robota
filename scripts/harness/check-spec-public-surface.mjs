#!/usr/bin/env node

/**
 * Check that every identifier a package SPEC advertises in its public-API table
 * actually appears somewhere in that package's `src/`.
 *
 * Guard G3-lite (architecture audit 2026-06-19, AF-13/AF-21 class). SPECs listed
 * phantom exports (e.g. `IPlaygroundBootState`, `createModelCommandModule`) that no
 * longer existed in source — the contract drifted from the code.
 *
 * Conservative by design — near-zero false positives:
 * - Only scans sections whose heading matches `Public API` (the standardized surface
 *   table). Type-ownership / dependency / build-output tables are ignored.
 * - Only checks the first back-tick token of each table row, and only when it is a
 *   bare JS identifier (`/^[A-Za-z_$][\w$]*$/`) — sub-paths (`./anthropic`), file
 *   paths, and prose are skipped.
 * - A real export's name always appears in `src/` (at its definition or barrel
 *   re-export); a phantom one appears nowhere. That asymmetry is the whole check.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listSpecPackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const HEADING = /^#{2,6}\s+(.*)$/;
const PUBLIC_API_HEADING = /public api/i;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_ROW = /^\s*\|[\s|:-]+\|\s*$/;
const FIRST_BACKTICK_TOKEN = /`([^`]+)`/;

// Identifiers that are language/spec vocabulary, not package exports.
const VOCAB = new Set(['Export', 'Symbol', 'Kind', 'Type', 'Name', 'Component', 'Hook']);

function collectSrcText(srcDir) {
  let text = '';
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    if (entry.isDirectory()) text += collectSrcText(full);
    else if (entry.isFile() && /\.(tsx|ts|mjs|cjs)$/.test(entry.name)) {
      text += readFileSync(full, 'utf8');
      text += '\n';
    }
  }
  return text;
}

function publicApiIdentifiers(specText) {
  const lines = specText.split('\n');
  const idents = [];
  let inPublicApi = false;
  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      inPublicApi = PUBLIC_API_HEADING.test(heading[1]);
      continue;
    }
    if (!inPublicApi) continue;
    if (SEPARATOR_ROW.test(line) || !TABLE_ROW.test(line)) continue;
    const cell = line.replace(/^\s*\|/, '').split('|')[0];
    const tokenMatch = cell.match(FIRST_BACKTICK_TOKEN);
    if (!tokenMatch) continue;
    const token = tokenMatch[1].trim();
    if (!IDENTIFIER.test(token) || VOCAB.has(token)) continue;
    idents.push(token);
  }
  return [...new Set(idents)];
}

export async function findPublicSurfaceFindings(root = WORKSPACE_ROOT) {
  const findings = [];

  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const srcDir = path.join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;

    const idents = publicApiIdentifiers(readFileSync(specPath, 'utf8'));
    if (idents.length === 0) continue;

    const srcText = collectSrcText(srcDir);
    for (const ident of idents) {
      const present = new RegExp(`\\b${ident}\\b`).test(srcText);
      if (!present) {
        findings.push({
          file: path.relative(root, specPath),
          type: 'spec-phantom-export',
          detail: `\`${ident}\` is advertised in the public-API table but appears nowhere in ${path.relative(root, srcDir)}.`,
        });
      }
    }
  }
  return findings;
}

export async function main() {
  const findings = await findPublicSurfaceFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('spec public-surface scan passed.\n');
    return;
  }
  process.stdout.write('spec public-surface scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
