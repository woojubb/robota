#!/usr/bin/env node
/**
 * INFRA-123 (issue #1887) — which files actually BIND a symbol to the declaration being changed.
 *
 * A bulk rename decides by NAME: it greps for a symbol's spelling and rewrites every site that
 * matches. That is wrong whenever the name is not unique, which for ordinary names is most of the
 * time.
 *
 * ## The measured failure
 *
 * A rewrite adding `await` to `createSession(` call sites edited three files that define their own
 * LOCAL helper of that name and import nothing from the package that changed:
 *
 *   packages/agent-session/src/__tests__/session-compaction.test.ts
 *   packages/agent-transport-mcp/src/__tests__/remote-command-admission.test.ts
 *   packages/agent-framework/src/interactive/__tests__/interactive-session-host-actions.test.ts
 *
 * Each was reverted before it was committed, and the reason it was caught was luck: the script
 * printed what it touched and the paths looked wrong for an unrelated reason.
 *
 * ## Why this is worse than the failure issue #1884 closed
 *
 * That one bounded where a bulk edit can REACH. This is about whether the sites it reaches are the
 * right ones — and a rewrite sourced correctly from `git ls-files`, staying inside `packages/*\/src`,
 * still edits every unrelated spelling in the workspace. It produces no test failure when the local
 * helper happens to be compatible, only a silent semantic change in an unrelated package. The
 * node_modules amplification announced itself in the printed paths; this does not announce itself.
 *
 * ## What this resolves, and what it deliberately does not
 *
 * The accurate answer is a TypeScript program built once over the workspace, which is also the slow
 * one. This reads each candidate file's own bindings instead: an import of the symbol from the target
 * module admits the file, and a local declaration of that name excludes it. That covers the measured
 * failure — a local helper shadowing an imported name — at a cost a rewrite can afford to pay per
 * file.
 *
 * It does NOT resolve a re-export chain, a namespace import used as `ns.createSession(...)`, or a
 * symbol reaching the file through a barrel under a different specifier. Those are stated as limits
 * rather than silently mis-answered: a resolver that guesses is the regex it replaces, wearing a
 * better name.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * `import { a, b as c } from 'x'` — the named-import clause and its module specifier.
 *
 * The clause may be preceded by a DEFAULT binding: `import Default, { createSession } from 'x'`. The
 * first cut required `{` immediately after `import`, so that form matched nothing and a file which
 * genuinely binds the symbol came back `does-not-import-the-symbol` — a real rewrite site skipped in
 * silence, which is this tool's own failure mode running in the other direction.
 */
const NAMED_IMPORT =
  /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** `import * as ns from 'x'` — recorded so a namespace import is reported rather than missed. */
const NAMESPACE_IMPORT = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g;

/** A binding the FILE introduces under this name, which shadows anything imported. */
function declaresLocally(source, symbol) {
  const patterns = [
    new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+${symbol}\b`),
    new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+${symbol}\b`),
    new RegExp(String.raw`(?:^|\n)\s*(?:export\s+)?class\s+${symbol}\b`),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

/** Every specifier this file imports `symbol` from, under that exact name. */
export function importSpecifiersFor(source, symbol) {
  const specifiers = [];
  NAMED_IMPORT.lastIndex = 0;
  let match;
  while ((match = NAMED_IMPORT.exec(source)) !== null) {
    const [, clause, specifier] = match;
    for (const entry of clause.split(',')) {
      const parts = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/);
      // `a as b` binds `b`; the local NAME is what a rewrite matches on, so that is what is compared.
      const bound = (parts[1] ?? parts[0] ?? '').trim();
      if (bound === symbol) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** Namespace imports, so `ns.symbol(...)` can be reported as unresolved rather than assumed absent. */
export function namespaceImports(source) {
  const found = [];
  NAMESPACE_IMPORT.lastIndex = 0;
  let match;
  while ((match = NAMESPACE_IMPORT.exec(source)) !== null)
    found.push({ alias: match[1], from: match[2] });
  return found;
}

/**
 * Does `specifier` name `module`?
 *
 * A package specifier is compared whole. A relative one is resolved against the importing file, so a
 * `.js` specifier and the `.ts` source it names both answer for the same declaration — the mapping
 * this workspace's ESM specifiers require. The paths in the cases below are fixtures, not files.
 */
function specifierNames(specifier, importerPath, module) {
  if (!specifier.startsWith('.')) return specifier === module;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(importerPath), specifier),
  );
  const stripped = resolved.replace(/\.[cm]?[jt]sx?$/, '');
  const target = module.replace(/\.[cm]?[jt]sx?$/, '');
  return stripped === target || stripped === `${target}/index`;
}

/** Why a file was admitted or excluded. A verdict without one is a regex with better manners. */
export const SITE = Object.freeze({
  BINDS: 'binds',
  SHADOWED: 'shadowed-by-local-declaration',
  NOT_IMPORTED: 'does-not-import-the-symbol',
  IMPORTED_ELSEWHERE: 'imports-that-name-from-another-module',
  UNRESOLVED: 'namespace-import-present-cannot-decide',
});

let examinedFiles = 0;

/** How many candidate files the last resolution opened. */
export function examinedFileCount() {
  return examinedFiles;
}

/**
 * Classify every candidate.
 *
 * The counter is RESET here rather than incremented from wherever it stood: a size that accumulates
 * across runs reads as a growing subject.
 */
export function collectRewriteSites(
  candidates,
  symbol,
  module,
  readFile = (file) => readFileSync(file, 'utf8'),
) {
  examinedFiles = 0;
  return candidates.map((file) => {
    examinedFiles += 1;
    const source = readFile(file);

    // Local declaration first: it shadows an import even when both are present, which is exactly the
    // shape the measured failure took in one of the three files.
    if (declaresLocally(source, symbol)) return { file, verdict: SITE.SHADOWED };

    const specifiers = importSpecifiersFor(source, symbol);
    if (specifiers.length === 0) {
      const namespaces = namespaceImports(source);
      if (namespaces.some((entry) => specifierNames(entry.from, file, module))) {
        return { file, verdict: SITE.UNRESOLVED };
      }
      return { file, verdict: SITE.NOT_IMPORTED };
    }
    if (specifiers.some((specifier) => specifierNames(specifier, file, module))) {
      return { file, verdict: SITE.BINDS };
    }
    return { file, verdict: SITE.IMPORTED_ELSEWHERE };
  });
}

function main() {
  const [symbol, module, ...candidates] = process.argv.slice(2);
  if (!symbol || !module || candidates.length === 0) {
    process.stderr.write(
      'usage: resolve-rewrite-sites.mjs <symbol> <module> <file>...\n' +
        '  <module> is the specifier the symbol is declared in — a package name, or a repo path.\n' +
        'Prints one `<verdict>\\t<file>` line per candidate. Only `binds` may be rewritten.\n',
    );
    process.exitCode = 2;
    return;
  }
  const sites = collectRewriteSites(candidates, symbol, module);
  for (const site of sites) process.stdout.write(`${site.verdict}\t${site.file}\n`);
  console.log(`::examined:: ${examinedFileCount()} candidate file(s)`);

  // A namespace import cannot be decided here, and a rewrite that treated "cannot decide" as "no"
  // would silently skip a real site — the same silence in the other direction.
  if (sites.some((site) => site.verdict === SITE.UNRESOLVED)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
