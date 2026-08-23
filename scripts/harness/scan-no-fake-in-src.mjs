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

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { listManifestPackageDirs, listSourceFiles } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Documented allowlist of PRE-EXISTING test-double-named shipped files (mirrors the `conflict-markers` scan's
 * allowlist convention). These predate this floor and are tracked for relocation/rename by
 * `.agents/tasks/completed/HARNESS-033-fake-in-src-sweep.md` — remove each entry as HARNESS-033 fixes it. A NEW file
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
  // FAIL-CLOSED (HARNESS-052). Returning the empty finding list here made the no-test-doubles floor
  // print `scan passed` over a tree it never opened — the same "success over work it did not do"
  // shape the floor itself exists to fence. An absent `packages/` is a broken checkout, not a clean
  // one.
  if (!existsSync(packagesDir))
    throw new Error(
      `packages/ does not exist under ${root}. This scan will not report a pass over source it ` +
        'could not read.',
    );
  // NESTING-AWARE (HARNESS-052 second pass). This walked `packages/` at depth 1, so
  // `packages/dag-nodes` — which has no `src/` of its own — was `continue`d and all 21 of its
  // members' 59 source files were never opened. The first pass hardened this function against a
  // MISSING tree while leaving its ENUMERATION one level deep, and `scan-guard-scope-fail-closed`
  // then pinned it as the mandatory guard of `packages` — certifying coverage it did not have.
  // Falsified: `export class MockToolClient {}` in `packages/dag-nodes/tool/src/index.ts` left this
  // scan printing `no-fake-in-src scan passed.`
  examinedShippableFiles = 0;
  for (const pkgDir of listManifestPackageDirs(root)) {
    const srcRel = path.relative(root, path.join(pkgDir, 'src'));
    if (!existsSync(path.join(root, srcRel)) || !statSync(path.join(root, srcRel)).isDirectory()) {
      continue;
    }
    for (const absolute of walkFiles(path.join(root, srcRel))) {
      const rel = path.relative(root, absolute);
      if (!isShippableSrc(rel)) continue;
      // Counted HERE — after the shippable filter, before the pre-existing allowlist. The allowlist
      // exempts a file from JUDGEMENT, not from the subject: counting after it would make the
      // reported size shrink as the tracked debt grows, which reads as a smaller responsibility
      // exactly when it widens. (HARNESS-057)
      examinedShippableFiles++;
      if (KNOWN_PREEXISTING.has(rel.replace(/\\/g, '/'))) continue; // pre-existing, tracked by HARNESS-033
      findings.push(
        ...findFakeDeclarationsInSource(readFileSync(path.join(root, rel), 'utf8'), rel),
      );
    }
  }
  return findings;
}

/**
 * Every file under a src tree, absolute. Test files are NOT excluded here — `isShippableSrc` owns
 * that decision, and it draws the line differently (it also excludes `testing/` and `__mocks__/`,
 * which are shipped test-support entries rather than tests).
 *
 * HARNESS-062: this used to be a private walker excluding `node_modules`/`dist` only. Measured on
 * the real tree when routed through the shared lister: 1606 shippable files before, 1606 after.
 */
function walkFiles(srcDir) {
  return listSourceFiles(srcDir, { excludeTests: false, extensions: null });
}

/**
 * How many shippable source files the last walk read — HARNESS-057. A module-level holder set where
 * the walk happens and read where the line is printed, so the finder's return shape and the tests
 * that assert on its findings stay untouched.
 */
let examinedShippableFiles = 0;

/** What the last `findFakeInSrc` run actually walked — exported so it can be asserted. */
export function examinedShippableFileCount() {
  return examinedShippableFiles;
}

function main() {
  const findings = findFakeInSrc();
  if (findings.length === 0) {
    // The size of the subject, on the channel the runner reads. Zero would mean the package walk
    // found no shippable source at all — a pass over nothing rather than a tree with no fakes — so
    // it carries no expected-empty excuse.
    console.log(`::examined:: ${examinedShippableFiles} shippable source files`);
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

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
