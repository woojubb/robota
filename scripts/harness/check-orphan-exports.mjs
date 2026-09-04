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
 * WHAT THIS SCAN DOES NOT SAY, stated because its finding text was read as saying it. A `packages/`
 * PUBLIC surface is exempt by construction — entry points, `package.json` export sources and
 * barrel-re-exported modules are all skipped above — so a red here is never evidence that an
 * exported library surface should be privatized or removed. In-repo consumer count is not evidence
 * about whether a surface should be public, at any count; the only grounds for narrowing one are
 * that it is genuinely unnecessary or that it does not fit the design
 * (`.agents/project-structure.md` § Forward-Provisioned Surface Rule, owner decision 2026-08-23).
 * Measured 2026-08-23: a session cleared nine of these by unexporting them, and the outcome was
 * right only because they were genuinely internal helpers of one codec directory. The session said
 * plainly that it unexported them because a scan was red, not because it had judged them internal —
 * so the message, not the logic, is what needed fixing.
 *
 * The 2026-06-11 launch baseline (153 frozen findings) was burned down to
 * zero and removed in HARNESS-015 (2026-06-13) — the scan now enforces
 * unconditionally. Intentional no-consumer exports live in the reasoned
 * allowlist below.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listWorkspacePackageDirs } from './workspace-packages.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * Symbols intentionally exported without in-repo consumers. Keep reasons.
 *
 * Two entry shapes. A BARE symbol name exempts that name everywhere, which is as wide as the
 * workspace and should be used only for framework conventions that really are name-keyed. A
 * `<workspace-relative file>:<symbol>` entry exempts exactly one declaration — prefer it, because a
 * bare name silently exempts every future symbol that happens to share it (HARNESS-052 sub-shape B:
 * an exemption wider than its reason is a guard quietly retired).
 */
export const ORPHAN_EXPORT_ALLOWLIST = new Set([
  'collections', // Astro content.config.ts convention export — loaded by the framework by path (apps/blog)
  'generateMetadata', // Next.js app-router convention export — called by the framework (apps/docs)
  // Absorbed dag-cli internals (WORKFLOW-001) — exported but currently only consumed in-package;
  // baseline-allowlisted on absorption, burndown tracked as a follow-up (un-export or wire).
  'GLOBAL_CATALOG_DIR', // dag-cli catalog-scanner
  'ALIASES_FILE', // dag-cli alias command
  'resolveAliasRef', // dag-cli alias command
  'loadSavedInstantNodes', // dag-cli instant-nodes handler
  'RunStore', // dag-cli run-store (consumers use the getRunStore factory)
  // HARNESS-052 baseline (2026-07-27), NOT a judgement that the export is intentional. Widening
  // this scan's enumerator to the nested `packages/dag-nodes/*` group surfaced it on the first run:
  // a GENUINE orphan (used only inside its own module, via `z.array(ProviderEntrySchema)`), whose
  // repair is deleting one `export` keyword in `packages/**` — a tree the branch that fixed the
  // enumerator did not own. Recorded file-scoped so it exempts this declaration and nothing else,
  // and so the burndown is a one-line diff plus this entry's removal.
  'packages/dag-nodes/llm-text/src/config.ts:ProviderEntrySchema',
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

/**
 * Every workspace package whose source is both swept for orphans AND used as the reference corpus.
 *
 * HARNESS-052: this read `packages/` at depth 1, so the 20 members of `packages/dag-nodes/*` were
 * outside the set on BOTH sides of the rule — their exports were never swept, and their imports
 * could not rescue a symbol exported elsewhere either, which is the more dangerous half (an orphan
 * verdict is quantified over the corpus). The claim in this scan's own message is "referenced
 * nowhere else in the workspace"; the enumerator now covers the workspace the manifest declares.
 */
function listSourcePackages(root) {
  return listWorkspacePackageDirs(root);
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

export async function findOrphanExportFindings(root = WORKSPACE_ROOT, options = {}) {
  requireGovernedTree(root, ['packages'], {
    scan: 'orphan-exports',
    why: 'An orphan verdict is quantified over the workspace reference corpus; an empty corpus makes every export an orphan and reports none.',
  });
  const allowlist = options.allowlist ?? ORPHAN_EXPORT_ALLOWLIST;
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
      const relativeFile = path.relative(root, file).split(path.sep).join('/');
      for (const symbol of extractRuntimeExports(content)) {
        if (allowlist.has(symbol) || allowlist.has(`${relativeFile}:${symbol}`)) continue;
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
          findings.push({
            file: relativeFile,
            type: 'orphan-export',
            detail:
              `${symbol} is exported from a non-entry module that no same-package barrel re-exports, ` +
              `and no other file references it. This is an INTERNAL export with no consumer — not a ` +
              `judgement about public surface. A packages/ public surface is exempt here (entry ` +
              `points, package.json export sources and barrel-re-exported modules are skipped) and is ` +
              `never judged by consumer count: see .agents/project-structure.md ` +
              `§ Forward-Provisioned Surface Rule. Unexport it, consume it, or route it through the ` +
              `barrel if it is meant to be public — do not privatize a public surface to clear this.`,
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

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
