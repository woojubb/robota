#!/usr/bin/env node

/**
 * HARNESS-032 — mechanical floor: no test-double naming (`Fake`/`Mock`/`Stub`) in shipped library code.
 *
 * Governance (owner, recurring): the words `fake`/`mock`/`stub` may name TEST doubles only — never shipped
 * dev/production code. A test double that ships as library API (a `FakeXClient` exported from `src/index.ts`, a
 * `createMock…()` used by a live UI) is the exact smell this fences. It complements `scan-no-fallback.mjs`
 * (HARNESS-028) — same worker/guardian shape, same suppression convention.
 *
 * It flags, in NON-TEST source under `packages/<pkg>/src` (excluding `__tests__/`, `testing/`, `*.test.ts`,
 * `*.spec.ts`, `dist/`), a DECLARATION or re-export whose identifier is `Fake*` / `Mock* `/ `Stub*`:
 *   - `(export )?(abstract )?class (Fake|Mock|Stub)<Name>` / `function` / `const` / `interface` / `type`
 *   - `create(Fake|Mock|Stub)<Name>(`
 *   - `export { … Fake<Name> / Mock<Name> / Stub<Name> … }`
 * String literals and comments are NOT matched — only real declarations/exports (the shippable surface).
 *
 * Escape hatch: a sanctioned occurrence carries an adjacent `// allow-fake: <reason>` (this line or the line
 * above). Anti-rot (mirrors HARNESS-028): a comment-scoped `allow-fake` MUST carry a `: <reason>`.
 *
 * Correct fix for a real hit: rename to what it IS (`ManualClockPort`, `RecordingTaskExecutorPort`,
 * `InMemory…`), or move the test double under a `testing/` subpath (exported via `./testing`, like agent-core's
 * `scripted-provider`) so it is test-support, never the package main entry.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Documented allowlist of PRE-EXISTING test-double-named shipped files (mirrors the `conflict-markers` scan's
 * allowlist convention). These predate this floor and are tracked for relocation/rename by
 * `.agents/backlog/HARNESS-033-fake-in-src-sweep.md` — remove each entry as HARNESS-033 fixes it. A NEW file
 * with a `Fake*`/`Mock*`/`Stub*` declaration is NOT on this list and therefore FAILS. Normalized to `/`.
 */
// HARNESS-033 emptied this baseline: the dag-adapters-local test-support ports were relocated to the
// `./testing` entry (ManualClockPort / ScriptedTaskExecutorPort / createCannedPromptBackend) and the
// agent-playground in-browser placeholders were renamed (Placeholder* / createSampleUsageSnapshot). The floor
// now rests entirely on rename/relocation — a NEW `Fake*`/`Mock*`/`Stub*` declaration in shipped src FAILs
// with no baseline to hide behind. Keep this set EMPTY; do not add exceptions.
const KNOWN_PREEXISTING = new Set([]);

/**
 * A test-double-named DECLARATION or re-export (the shippable surface) — NOT imports or bare call sites:
 *   - `class|interface|type|abstract class Fake<Name>` (incl. object-literal `class expressions`)
 *   - a declared factory `function create(Fake|Mock|Stub)<Name>` / `const create(Fake|Mock|Stub)<Name> =`
 *   - `export { … Fake<Name> / Mock<Name> / Stub<Name> … }`
 * A leading string quote before the keyword (injected-code string literal) is excluded by `hasFakeDeclaration`.
 */
const FAKE_DECL_PATTERNS = [
  // class/interface/type/enum named Fake*/Mock*/Stub* (incl. object-literal class expressions)
  /\b(?:abstract\s+)?(?:class|interface|type|enum)\s+(?:Fake|Mock|Stub)[A-Z]/,
  // a function DECLARED as Fake*/Mock*/Stub* or create(Fake|Mock|Stub)* (declaration only — not call sites)
  /\b(?:export\s+)?(?:async\s+)?function\s+(?:create)?(?:Fake|Mock|Stub)[A-Z]/,
  // a const/let BOUND to a Fake*/Mock*/Stub*- or create(Fake|Mock|Stub)*-named binding (requires `=`/`:` → decl,
  // not a bare call site like `createMockUsageSnapshot()`)
  /\b(?:export\s+)?(?:const|let)\s+(?:create)?(?:Fake|Mock|Stub)[A-Z]\w*\s*[:=]/,
  // a re-export of a Fake*/Mock*/Stub*-named symbol
  /\bexport\s*(?:type\s*)?\{[^}]*\b(?:Fake|Mock|Stub)[A-Z]/,
];

/** True when a line DECLARES/re-exports a test-double-named identifier (not an import, comment, or string literal). */
function hasFakeDeclaration(line) {
  if (/^\s*import\b/.test(line)) return false; // imports are consequences, not the declaration
  if (/^\s*(?:\/\/|\/?\*)/.test(line)) return false; // a comment line (`//`, `/*`, or a JSDoc `*` continuation)
  const firstQuoteIdx = line.search(/['"`]/);
  const lineCommentIdx = line.indexOf('//');
  const blockCommentIdx = line.indexOf('/*');
  for (const re of FAKE_DECL_PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    // Skip a match inside a string literal (injected browser-code strings): a quote opens before it.
    if (firstQuoteIdx !== -1 && firstQuoteIdx < m.index) continue;
    // Skip a match inside a comment (doc prose that merely mentions a declaration).
    if (lineCommentIdx !== -1 && lineCommentIdx < m.index) continue;
    if (blockCommentIdx !== -1 && blockCommentIdx < m.index) continue;
    return true;
  }
  return false;
}

/** A well-formed escape hatch: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION_WITH_REASON = /allow-fake:\s*\S/;

/** Whether `allow-fake` on this line sits in a COMMENT (line/JSDoc/block), not a string. */
function annotationInComment(line) {
  const trimmed = line.trim();
  return (
    /\/\/[^\n]*allow-fake/.test(line) ||
    /\/\*[^\n]*allow-fake/.test(line) ||
    (/^\*/.test(trimmed) && /allow-fake/.test(trimmed))
  );
}

/**
 * Pure content check (exposed for tests): one finding per source line declaring/exporting a `Fake*`/`Mock*`/
 * `Stub*` identifier, unless suppressed by an adjacent `allow-fake: <reason>` (this or the previous line).
 */
export function findFakeDeclarationsInSource(source, file = 'fixture.ts') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (hasFakeDeclaration(line)) {
      // Suppressed only by (a) a same-line trailing `allow-fake: <reason>`, or (b) a DEDICATED comment line
      // directly above carrying the reason. A trailing annotation on the PREVIOUS declaration line must NOT
      // bleed onto this one (that was the suppression-bleed defect), so the above-line case requires the
      // previous line to be a comment that is not itself a flagged declaration.
      const prev = lines[i - 1] ?? '';
      const suppressedSameLine = ANNOTATION_WITH_REASON.test(line);
      const suppressedByCommentAbove =
        annotationInComment(prev) && ANNOTATION_WITH_REASON.test(prev) && !hasFakeDeclaration(prev);
      if (!suppressedSameLine && !suppressedByCommentAbove) {
        findings.push({ file, line: i + 1, kind: 'fake-in-src', text: line.trim().slice(0, 120) });
      }
    }
    // Anti-rot (reason-less-only): a comment-scoped `allow-fake` MUST carry a `: <reason>`.
    if (annotationInComment(line) && !ANNOTATION_WITH_REASON.test(line)) {
      findings.push({
        file,
        line: i + 1,
        kind: 'reasonless-annotation',
        text: line.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

/** Is this path NON-TEST source under a package's `src/` (the shippable surface)? */
function isShippableSrc(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (!norm.startsWith('packages/') || !norm.includes('/src/')) return false;
  if (!/\.tsx?$/.test(norm)) return false;
  if (/\.test\.tsx?$|\.spec\.tsx?$/.test(norm)) return false;
  return !(
    norm.includes('/__tests__/') ||
    norm.includes('/testing/') ||
    norm.includes('/__mocks__/') ||
    norm.includes('/dist/')
  );
}

export function findFakeInSrc(root = WORKSPACE_ROOT) {
  const findings = [];
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return findings;
  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const srcRel = path.join('packages', pkg.name, 'src');
    if (!existsSync(path.join(root, srcRel)) || !statSync(path.join(root, srcRel)).isDirectory()) {
      continue;
    }
    for (const rel of walkFiles(srcRel, root)) {
      if (!isShippableSrc(rel)) continue;
      if (KNOWN_PREEXISTING.has(rel.replace(/\\/g, '/'))) continue; // pre-existing, tracked by HARNESS-033
      findings.push(
        ...findFakeDeclarationsInSource(readFileSync(path.join(root, rel), 'utf8'), rel),
      );
    }
  }
  return findings;
}

/** Collect all files under a src tree (test dirs are filtered later by isShippableSrc), relative to `root`. */
function walkFiles(target, root = WORKSPACE_ROOT) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(child, root));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function main() {
  const findings = findFakeInSrc();
  if (findings.length === 0) {
    console.log('no-fake-in-src scan passed.');
    process.exit(0);
  }
  console.error('no-fake-in-src scan FAILED — test-double naming in shipped library source:');
  for (const f of findings) {
    console.error(`  [${f.kind}] ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\n`fake`/`mock`/`stub` name TEST doubles only — never shipped code. Fix a hit by:\n' +
      '  - renaming to what it IS (ManualClockPort / RecordingTaskExecutorPort / InMemory…), OR\n' +
      '  - moving the test double under a `testing/` subpath (exported via `./testing`), OR\n' +
      '  - annotating a genuinely-sanctioned occurrence with `// allow-fake: <reason>`.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
