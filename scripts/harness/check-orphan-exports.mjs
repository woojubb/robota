#!/usr/bin/env node

/**
 * Check for orphaned runtime exports — exported symbols no other file references.
 *
 * Lesson source: the ARCH-002 refactor orphaned four shipped features
 * (first-run welcome, diagnose command, terminal warning, init dispatch);
 * build/typecheck/lint/tests all stayed green for weeks (HARNESS-001,
 * 2026-06-11).
 *
 * Scope (v1, deliberately a tripwire rather than full dead-code analysis):
 * - Runtime exports only (`export function|class|const` and `export { ... }`
 *   lists without `type`); interface/type exports are ignored.
 * - A symbol is an orphan when its name appears in no other scanned file.
 * - Exemptions: entry-point files (index/browser/bin and package.json exports
 *   sources), modules re-exported by a same-package barrel (`export ... from`),
 *   and the explicit allowlist below.
 *
 * Known limitations (accepted): identical names elsewhere hide true orphans;
 * dynamic access (obj[name]) is invisible. The goal is catching refactor
 * fallout, not perfect reachability.
 *
 * Baseline ratchet: orphan-export-baseline.json freezes the pre-existing
 * findings (2026-06-11) with a written reason; only NEW orphans fail. The
 * baseline burn-down is tracked as backlog HARNESS-015 — when an entry's
 * symbol is deleted or gains a consumer, remove the entry.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const BASELINE_PATH = path.join(import.meta.dirname, 'orphan-export-baseline.json');

/** Symbols intentionally exported without in-repo consumers. Keep reasons. */
export const ORPHAN_EXPORT_ALLOWLIST = new Set([
  // (populated by live triage; format: 'symbolName', // reason
]);

const ENTRY_BASENAMES = new Set(['index.ts', 'index.tsx', 'browser.ts', 'bin.ts', 'node.ts']);

const DECL_PATTERN =
  /^export\s+(?:async\s+)?(?:function|class|const|let|enum)\s+([A-Za-z_$][\w$]*)/gm;
const LIST_PATTERN = /^export\s+\{([^}]+)\}\s*(?:;|$)/gm;

function walkFiles(dir, results) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage')
        continue;
      walkFiles(full, results);
    } else if (entry.isFile() && /\.(ts|tsx|mjs|cjs|js|jsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
}

function isTestFile(filePath) {
  return /__tests__|\.(test|spec)\./.test(filePath);
}

function listSourcePackages(root) {
  const dirs = [];
  for (const family of ['packages', 'apps']) {
    const familyDir = path.join(root, family);
    if (!existsSync(familyDir)) continue;
    for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgDir = path.join(familyDir, entry.name);
      if (existsSync(path.join(pkgDir, 'package.json'))) dirs.push(pkgDir);
    }
  }
  return dirs;
}

function exportSourceEntries(pkgDir) {
  const entries = new Set();
  const pkgPath = path.join(pkgDir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const exportsField = pkg.exports ?? {};
    const visit = (value) => {
      if (typeof value === 'string') {
        if (value.startsWith('./src/')) entries.add(path.resolve(pkgDir, value));
        return;
      }
      if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) visit(inner);
      }
    };
    visit(exportsField);
  } catch {
    // allow-fallback: unreadable package.json is reported by other scans; entry detection degrades to basenames
  }
  return entries;
}

function extractRuntimeExports(content) {
  const names = [];
  for (const match of content.matchAll(DECL_PATTERN)) {
    names.push(match[1]);
  }
  for (const match of content.matchAll(LIST_PATTERN)) {
    if (/from\s+['"]/.test(match[0])) continue; // re-export lists are surface, not definitions
    for (const part of match[1].split(',')) {
      const token = part.trim();
      if (!token || token.startsWith('type ')) continue;
      const name = (token.includes(' as ') ? token.split(' as ')[1] : token).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
    }
  }
  return names;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  return new Set(baseline.entries.map((entry) => `${entry.file}::${entry.symbol}`));
}

export async function findOrphanExportFindings(root = WORKSPACE_ROOT, options = {}) {
  const allowlist = options.allowlist ?? ORPHAN_EXPORT_ALLOWLIST;
  const baseline = options.baseline ?? (root === WORKSPACE_ROOT ? loadBaseline() : new Set());
  const findings = [];

  // Corpus: all source/script files that may reference symbols.
  const corpusFiles = [];
  for (const pkgDir of listSourcePackages(root)) {
    walkFiles(path.join(pkgDir, 'src'), corpusFiles);
    walkFiles(path.join(pkgDir, 'scripts'), corpusFiles);
    walkFiles(path.join(pkgDir, 'bin'), corpusFiles);
  }
  walkFiles(path.join(root, 'scripts'), corpusFiles);

  const corpusContents = new Map(corpusFiles.map((file) => [file, readFileSync(file, 'utf8')]));

  for (const pkgDir of listSourcePackages(root)) {
    const srcDir = path.join(pkgDir, 'src');
    const entrySources = exportSourceEntries(pkgDir);

    const packageFiles = corpusFiles.filter((file) => file.startsWith(srcDir + path.sep));

    // Modules whose exports are re-exported by a same-package barrel.
    const barrelExemptModules = new Set();
    for (const file of packageFiles) {
      const content = corpusContents.get(file) ?? '';
      for (const match of content.matchAll(
        /export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g,
      )) {
        const resolved = path.resolve(path.dirname(file), match[1]);
        for (const ext of ['', '.ts', '.tsx', '.mjs']) {
          barrelExemptModules.add(resolved.replace(/\.(js|ts|tsx|mjs)$/, '') + ext);
        }
        barrelExemptModules.add(resolved.replace(/\.js$/, '.ts'));
      }
    }

    for (const file of packageFiles) {
      if (isTestFile(file)) continue;
      if (ENTRY_BASENAMES.has(path.basename(file))) continue;
      if (entrySources.has(file)) continue;
      const fileNoExt = file.replace(/\.(ts|tsx|mjs)$/, '');
      if (barrelExemptModules.has(file) || barrelExemptModules.has(fileNoExt)) continue;

      const content = corpusContents.get(file) ?? '';
      for (const symbol of extractRuntimeExports(content)) {
        if (allowlist.has(symbol)) continue;
        const pattern = new RegExp(`\\b${symbol}\\b`);
        let referenced = false;
        for (const [otherFile, otherContent] of corpusContents) {
          if (otherFile === file) continue;
          if (pattern.test(otherContent)) {
            referenced = true;
            break;
          }
        }
        if (!referenced) {
          const relativeFile = path.relative(root, file);
          if (baseline.has(`${relativeFile}::${symbol}`)) continue;
          findings.push({
            file: relativeFile,
            type: 'orphan-export',
            detail: `${symbol} is exported but referenced nowhere else in the workspace.`,
          });
        }
      }
    }
  }

  return findings;
}

export async function main() {
  const findings = await findOrphanExportFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('orphan export scan passed.\n');
    return;
  }
  process.stdout.write('orphan export scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
