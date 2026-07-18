#!/usr/bin/env node

/**
 * HARNESS-028 — mechanical floor for the No Fallback Policy (operational.md).
 *
 * The rule "a single, correct, verifiable path; no silent try/catch alternatives" was enforced
 * ONLY by review — no scan covered production `packages/` code (the existing `conflict-markers`
 * scan targets harness prose only). This scan is the always-on guardian that closes that gap.
 *
 * It reports TWO finding kinds over `packages/<pkg>/src` (excluding tests + build output):
 *
 *  1. `unannotated-fallback` — a HIGH-CONFIDENCE silent fallback: a `catch` block whose FIRST
 *     meaningful statement RETURNS A BARE DEFAULT LITERAL (`null`/`undefined`/`[]`/`{}`/`''`/
 *     `false`/`true`/`0`/`-1`) and which contains NO `throw`. That is the swallow-and-return-default
 *     shape — the error is discarded and a default is produced as if nothing failed. This is v1's
 *     ONLY flagged construct (per the GATE-APPROVED precision mandate). It DELIBERATELY excludes:
 *       - error-RESULT returns (`return { ok: false }`, `return { success: false, error }`,
 *         `return err`, error strings) — legitimate terminal error-surfacing, not a fallback;
 *       - `x ?? default` value-precedence and defaulting-`||`;
 *       - `catch` blocks that rethrow / log-and-throw (a `throw` anywhere in the block);
 *       - a `catch` whose first act is anything other than the default return (e.g. logging first).
 *     The `f() || g()` both-calls rule is DEFERRED behind a proven `ruleid:`/`ok:` fixture corpus
 *     (it cannot syntactically tell lazy-init `cache.get() || fetch()` from `primary() || fallback()`).
 *     A sanctioned occurrence is suppressed by an adjacent `// allow-fallback: <reason>` annotation
 *     inside the catch block (the codebase's existing convention).
 *
 *  2. `reasonless-annotation` — anti-rot on the escape hatch itself (the mypy `ignore-without-code`
 *     analogue): an `allow-fallback` annotation that does NOT carry a `: <reason>` fails. Every
 *     suppression must state WHY. STALE-detection (the `warn_unused_ignores` analogue — an annotation
 *     that suppresses nothing) is DEFERRED to a future revision: while v1 flags only the narrow
 *     catch-return-default construct, an `allow-fallback:` on any OTHER construct is INERT, not stale.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Bare default-literal return — the high-confidence silent-fallback value shape. */
const DEFAULT_LITERAL_RETURN =
  /^return\s+(null|undefined|\[\]|\{\}|''|""|``|false|true|0|-1)\s*;?$/;

/** The escape-hatch token. A sanctioned fallback carries `allow-fallback: <reason>`. */
const ANNOTATION = /allow-fallback/;
/** A well-formed annotation: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION_WITH_REASON = /allow-fallback:\s*\S/;

const SCAN_DIRS = ['packages'];

/** Collect every non-test, non-dist `.ts`/`.tsx` file under a package tree. */
function walkSource(target) {
  const full = path.join(WORKSPACE_ROOT, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) {
    return /\.tsx?$/.test(full) ? [full] : [];
  }
  const files = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSource(child));
    } else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      files.push(path.join(WORKSPACE_ROOT, child));
    }
  }
  return files;
}

/** Strip a leading line comment / block-comment fragment so the FIRST real statement is found. */
function isCommentOrEmpty(line) {
  return line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*');
}

/**
 * Brace-match the body of a `catch (...) {` starting at `braceIndex` (the position of the `{`).
 * Returns the inner body text (without the outer braces).
 */
function extractBlockBody(src, braceIndex) {
  let depth = 0;
  let body = '';
  for (let i = braceIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      depth += 1;
      if (depth === 1) continue; // skip the outer opening brace
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) break; // reached the matching close
    }
    body += ch;
  }
  return body;
}

/**
 * Pure content check: return the no-fallback findings in a source string. Exposed so the harness
 * test can assert the flag/suppress/anti-rot behavior directly, without touching disk.
 *
 * Each finding: `{ file, line, kind: 'unannotated-fallback' | 'reasonless-annotation', text }`.
 */
export function findNoFallbackFindingsInSource(source, file = 'fixture.ts') {
  const findings = [];
  const lines = source.split('\n');

  // (1) unannotated silent fallbacks: catch { <default-literal return>, no throw }
  const catchRe = /catch\s*(\([^)]*\))?\s*\{/g;
  let match;
  while ((match = catchRe.exec(source)) !== null) {
    const braceIndex = match.index + match[0].length - 1;
    const body = extractBlockBody(source, braceIndex);
    if (/\bthrow\b/.test(body)) continue; // rethrows / wraps-and-throws — not a swallow
    const stmts = body
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => !isCommentOrEmpty(s));
    if (stmts.length === 0) continue;
    if (!DEFAULT_LITERAL_RETURN.test(stmts[0])) continue; // first act must BE the default return
    const line = source.slice(0, match.index).split('\n').length;
    // Suppressed by an adjacent `allow-fallback: <reason>` annotation. The window spans the catch's
    // own lines — from the line ABOVE `catch` (leading-comment convention) through the CLOSING brace
    // line (inline trailing-comment convention) — covering every placement the codebase uses.
    const closingLine = source.slice(0, braceIndex + body.length + 2).split('\n').length;
    const window = lines.slice(Math.max(0, line - 2), closingLine).join('\n');
    if (ANNOTATION_WITH_REASON.test(window)) continue;
    findings.push({
      file,
      line,
      kind: 'unannotated-fallback',
      text: `catch { ${stmts[0]} }`,
    });
  }

  // (2) anti-rot: a reason-less `allow-fallback` annotation (v1 = reason-less-only).
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (ANNOTATION.test(line) && !ANNOTATION_WITH_REASON.test(line)) {
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

export function findNoFallbackFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkSource(dir)) {
      // Neutrality/fallback is a property of production source, not test fixtures.
      const rel = path.relative(root, file);
      if (!rel.includes(`${path.sep}src${path.sep}`)) continue; // packages/<name>/src/** only
      findings.push(...findNoFallbackFindingsInSource(readFileSync(file, 'utf8'), rel));
    }
  }
  return findings;
}

function main() {
  const findings = findNoFallbackFindings();
  if (findings.length === 0) {
    console.log('no-fallback scan passed.');
    process.exit(0);
  }
  console.error('no-fallback scan FAILED — undeclared silent fallback / reason-less annotation:');
  for (const f of findings) {
    console.error(`  [${f.kind}] ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\nNo Fallback Policy (operational.md): a single, correct, verifiable path.\n' +
      '  - unannotated-fallback: remove the silent catch→default, surface the error, OR — if this\n' +
      '    degradation is genuinely sanctioned — annotate the return with `// allow-fallback: <reason>`.\n' +
      '  - reasonless-annotation: every `allow-fallback` MUST carry a `: <reason>`.\n' +
      "  Intentional fallbacks are also declared in the spec's `## Fallback & Degradation Declaration`.",
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
