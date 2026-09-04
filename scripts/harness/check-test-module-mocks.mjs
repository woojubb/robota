#!/usr/bin/env node

/**
 * Hardcoded workspace-module mock scan (lesson 2026-07-02).
 *
 * A test that replaces a whole workspace package with a hardcoded factory —
 * `vi.mock('@robota-sdk/agent-core', () => ({ onlyTheExportsIKnew }))` — silently severs every OTHER export
 * of that package for the entire import graph of the file under test. The stub then breaks the
 * moment any transitively-loaded module starts using a new export: agent-playground's
 * `vi.mock('@robota-sdk/agent-core')` stubbed 2 exports, TERM-008 added `resolvePlatformShell`,
 * and every `git push` in the repo was blocked by a failure in a package the change never touched
 * (while CI stayed green — the breakage surfaced only in the full local suite).
 *
 * Correct form: partial-mock with the real module spread, so unknown exports keep working. Both
 * spellings of "give me the real module" are accepted, because they are equivalent:
 *
 *   vi.mock('@robota-sdk/agent-core', async (importOriginal) => ({
 *     ...(await importOriginal<typeof import('@robota-sdk/agent-core')>()),
 *     onlyWhatThisTestOverrides: stub,
 *   }));
 *
 *   vi.mock('@robota-sdk/agent-core', async () => {
 *     const actual = await vi.importActual<typeof import('@robota-sdk/agent-core')>(
 *       '@robota-sdk/agent-core',
 *     );
 *     return { ...actual, onlyWhatThisTestOverrides: stub };
 *   });
 *
 * What makes a factory SAFE is not which helper it calls but that the real module is **spread**
 * into the result. A factory that fetches the original and then ignores it severs exports exactly
 * like a hardcoded one, so the spread is what this scan actually requires (HARNESS-025).
 *
 * The factory is delimited by balanced parentheses rather than a fixed character window: long
 * factories used to push their spread past the window and be misreported as hardcoded.
 *
 * This scan fails on NEW hardcoded workspace-module mock factories. Pre-existing violations are
 * pinned in ALLOWLIST below (tracked for burn-down by the MOCK-001 backlog item) — removing an
 * entry is welcome once its file is converted; adding one requires the same review as any
 * allowlist change. A deliberate full replacement can opt out with a same-line escape:
 * `// allow-module-mock: <reason>`.
 *
 * The allowlist is also checked for ROT: an entry whose file is now clean (or gone) fails the scan
 * and must be deleted. An allowlist that can only shrink keeps the burn-down count honest.
 *
 * Exit code 0 = no new violations, 1 = new hardcoded workspace mock OR a stale allowlist entry.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { escapeForRegExp, resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Test globs are approximated by a directory walk filtered to *.test.ts / *.test.tsx. */
const SCAN_ROOTS = ['packages', 'apps'];

// HARNESS-067: built from the configured scope. This was the SECOND instance of the exact shape the
// audit isolated, and it was invisible until the scope-literal ratchet learned to see `\/` inside a
// regex literal — which is how it is written here.
const MOCK_PATTERN = new RegExp(
  `vi\\.mock\\(\\s*(['"])(${escapeForRegExp(loadHarnessConfig().npmScopePrefix)}[^'"]+)\\1\\s*,`,
  'g',
);
const ESCAPE_PATTERN = /\/\/\s*allow-module-mock:\s*\S/;

/** Either spelling of "load the real module": the `importOriginal` param, or `vi.importActual`. */
const ORIGINAL_IMPORT_PATTERN = /\b(importOriginal|importActual)\s*[(<]/;
/** A spread of the original loaded inline: `...(await importOriginal())`. */
const INLINE_SPREAD_PATTERN = /\.\.\.\s*\(?\s*await\s+[\w.]*\b(importOriginal|importActual)\s*[(<]/;
/** `const actual = await vi.importActual(...)` / `const mod = await importOriginal()`. */
const ORIGINAL_BINDING_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w.]*\b(?:importOriginal|importActual)\s*[(<]/g;

/**
 * Remaining pre-existing violations — burn-down tracked by
 * `.agents/tasks/MOCK-001-hardcoded-workspace-mock-burndown.md`. Do not add entries for new code.
 *
 * HARNESS-025 burn-down (2026-07-25): 32 entries → 3. Two thirds of the original list were never
 * hardcoded at all — they were correct `vi.importActual` partial mocks that the old detector could
 * not see (it looked only for the literal `importOriginal`, inside a 600-char window that long
 * factories overflowed). Fixing the detector cleared 20 entries; converting the genuinely hardcoded
 * dag-cli and dag-nodes factories cleared 9 more.
 *
 * The 3 that remain are real hardcoded factories, left only because they sit in packages another
 * concurrent work-stream owns. They are the whole of the remaining burn-down.
 */
const ALLOWLIST = new Set([
  'packages/agent-cli/src/__tests__/provider-factory-integration.test.ts',
  'packages/agent-framework/src/__tests__/create-subagent-session.test.ts',
  'packages/agent-framework/src/__tests__/subagent-integration.test.ts',
]);

async function* walkTestFiles(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTestFiles(full);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

/**
 * Slice out the whole `vi.mock(...)` call starting at `startIndex` by matching parentheses,
 * skipping over string/template literals and comments so a paren inside them cannot unbalance the
 * count. Falls back to the rest of the file if the call is never closed (unparseable source).
 *
 * A fixed character window used to truncate long factories before their spread, misreporting a
 * correct partial mock as hardcoded.
 *
 * @param {string} content full file text
 * @param {number} startIndex index of the `vi.mock(` match
 * @returns {string} the source of the call, including the closing paren
 */
export function extractMockCall(content, startIndex) {
  const openParen = content.indexOf('(', startIndex);
  if (openParen === -1) return content.slice(startIndex);

  let depth = 0;
  for (let i = openParen; i < content.length; i += 1) {
    const ch = content[i];

    if (ch === '/' && content[i + 1] === '/') {
      const nl = content.indexOf('\n', i);
      i = nl === -1 ? content.length : nl;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*') {
      const end = content.indexOf('*/', i + 2);
      i = end === -1 ? content.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }

    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return content.slice(startIndex, i + 1);
    }
  }
  return content.slice(startIndex);
}

/**
 * Does this factory spread the REAL module into its result?
 *
 * Accepts the inline form (`...(await importOriginal())`) and the bound form
 * (`const actual = await vi.importActual(...)` … `...actual`). Merely *calling* an original-import
 * helper is not enough: a factory that loads the original and then drops it severs exports exactly
 * like a hardcoded one.
 *
 * @param {string} factory source of the `vi.mock(...)` call
 * @returns {boolean}
 */
export function spreadsOriginalModule(factory) {
  if (!ORIGINAL_IMPORT_PATTERN.test(factory)) return false;
  if (INLINE_SPREAD_PATTERN.test(factory)) return true;

  for (const binding of factory.matchAll(ORIGINAL_BINDING_PATTERN)) {
    const identifier = binding[1];
    if (new RegExp(String.raw`\.\.\.\s*${identifier}\b`).test(factory)) return true;
  }
  return false;
}

/**
 * Classify one file's content.
 * @returns {Array<{ module: string, line: number }>} hardcoded workspace-mock factories found.
 */
export function findHardcodedModuleMocks(content) {
  const violations = [];
  for (const match of content.matchAll(MOCK_PATTERN)) {
    if (spreadsOriginalModule(extractMockCall(content, match.index))) continue;
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const lineEnd = content.indexOf('\n', match.index);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (ESCAPE_PATTERN.test(line)) continue;
    violations.push({
      module: match[2],
      line: content.slice(0, match.index).split('\n').length,
    });
  }
  return violations;
}

/**
 * Allowlist entries that no longer earn their place: the file is clean now, or it is gone.
 *
 * HARNESS-025: without this, a fixed file keeps its allowlist entry forever and the burn-down count
 * silently overstates the remaining work — which is exactly how 20 already-correct files stayed
 * pinned. An allowlist that can only shrink keeps the count honest.
 *
 * @param {Iterable<string>} allowlist allowlisted repo-relative paths
 * @param {Map<string, Array<unknown>>} violationsByFile violations per scanned file; a path absent
 *   from the map was not found on disk, which is stale for the same reason
 * @returns {string[]} sorted stale entries
 */
export function findStaleAllowlistEntries(allowlist, violationsByFile) {
  return [...allowlist].filter((entry) => (violationsByFile.get(entry) ?? []).length === 0).sort();
}

export async function main() {
  const findings = [];
  /** file → its violations, for every test file actually present on disk. */
  const violationsByFile = new Map();
  for (const rootDir of SCAN_ROOTS) {
    for await (const file of walkTestFiles(path.join(WORKSPACE_ROOT, rootDir))) {
      const relative = path.relative(WORKSPACE_ROOT, file);
      const content = await fs.readFile(file, 'utf8');
      const violations = findHardcodedModuleMocks(content);
      violationsByFile.set(relative, violations);
      if (ALLOWLIST.has(relative)) continue;
      for (const violation of violations) {
        findings.push({ file: relative, ...violation });
      }
    }
  }

  const stale = findStaleAllowlistEntries(ALLOWLIST, violationsByFile);
  if (stale.length > 0) {
    process.stdout.write(
      'test-module-mocks scan failed — stale ALLOWLIST entries (file is clean or gone; delete the entry):\n',
    );
    for (const entry of stale) process.stdout.write(`  - ${entry}\n`);
    process.exitCode = 1;
    return;
  }

  if (findings.length === 0) {
    process.stdout.write(`test-module-mocks scan passed (${ALLOWLIST.size} legacy allowlisted).\n`);
    return;
  }

  process.stdout.write(
    'test-module-mocks scan failed — hardcoded workspace-module mock factory (breaks when the real module grows):\n',
  );
  for (const finding of findings) {
    process.stdout.write(`  - ${finding.file}:${finding.line} mocks ${finding.module}\n`);
  }
  process.stdout.write(
    'Use a partial mock instead: vi.mock(mod, async (importOriginal) => ({ ...(await importOriginal()), <overrides> })).\n' +
      'A deliberate full replacement can annotate the vi.mock line with // allow-module-mock: <reason>.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
