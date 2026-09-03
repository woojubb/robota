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
 * SCOPE (v1): `packages/<pkg>/src` only. `apps/<app>/src` (deployable production code, equally subject to
 * the policy) is a documented DEFERRAL — add it once the packages floor has settled with no false-positive
 * noise. The brace-matcher is string/comment-aware and the catch match excludes promise `.catch()`
 * handlers, so the near-zero-false-positive mandate holds for the covered tree.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { listSourceFiles } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Bare default-literal return — the high-confidence silent-fallback value shape. */
const DEFAULT_LITERAL_RETURN =
  /^return\s+(null|undefined|\[\]|\{\}|''|""|``|false|true|0|-1)\s*;?$/;

/** A well-formed escape hatch: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION_WITH_REASON = /allow-fallback:\s*\S/;

const SCAN_DIRS = ['packages'];

/**
 * CORE-029 — the swallow kinds arrive with a BURN-DOWN baseline, not as a wall.
 *
 * `silent-catch` and `discarded-rejection` were never scanned for, and the tree already contains 49
 * of them. Failing on all of them at once would block every unrelated pull request until someone
 * fixed 49 unrelated files, which is how a floor teaches people to route around it. So the existing
 * set is frozen: a NEW one fails, and the frozen set may shrink but never grow — the same ratchet
 * `scan-file-size` uses, for the same reason.
 *
 * `unannotated-fallback` and `reasonless-annotation` are unaffected and still fail outright.
 */
const BASELINED_KINDS = new Set(['silent-catch', 'discarded-rejection']);
const BASELINE_PATH = path.join(import.meta.dirname, 'no-fallback-swallow-baseline.json');

/** A baselined finding's identity: the file it is in, not its line — comments move, defects do not. */
function baselineKey(finding) {
  return `${finding.file}::${finding.kind}`;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/**
 * Split findings into what must fail now and what the ratchet has to say.
 *
 * Counted per file rather than per line so that editing a file above a frozen swallow does not
 * report it as new — the thing being frozen is "this file still has N of these", and the only
 * accepted direction is down.
 */
export function applySwallowBaseline(findings, baseline) {
  const counts = new Map();
  for (const finding of findings) {
    if (!BASELINED_KINDS.has(finding.kind)) continue;
    const key = baselineKey(finding);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const failures = findings.filter((f) => !BASELINED_KINDS.has(f.kind));
  const ratchet = [];

  for (const [key, count] of counts) {
    const frozen = baseline[key] ?? 0;
    if (count > frozen) {
      const [file, kind] = key.split('::');
      failures.push({
        file,
        line: 0,
        kind,
        text:
          frozen === 0
            ? `a new ${kind} appeared here — surface the error, or declare it with an adjacent \`allow-fallback: <reason>\``
            : `${kind} count grew from ${frozen} to ${count} in this file — frozen debt may shrink, never grow`,
      });
    }
  }
  for (const [key, frozen] of Object.entries(baseline)) {
    const count = counts.get(key) ?? 0;
    if (count < frozen) ratchet.push({ key, frozen, count });
  }

  return { failures, ratchet, counts };
}

/**
 * Collect every non-test, non-dist `.ts`/`.tsx` file under a package tree.
 *
 * HARNESS-052: `root` is threaded through rather than closed over `WORKSPACE_ROOT`. It was already a
 * parameter of the exported finder, but only the relative-path calculation honoured it — so the
 * function walked the real tree no matter which root it was handed, and read as root-parameterised
 * while not being so.
 *
 * HARNESS-062: the recursion itself is now the shared lister — this was one of six private
 * exclusion sets. Measured on the real tree when routed: 1620 files before, 1620 after. The
 * single-file `target` branch stays here: it is this scan's own entry contract, not part of the
 * walk.
 */
function walkSource(target, root) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) {
    return /\.tsx?$/.test(full) ? [full] : [];
  }
  return listSourceFiles(full, { extensions: ['.ts', '.tsx'] });
}

/** Strip a leading line comment / block-comment fragment so the FIRST real statement is found. */
function isCommentOrEmpty(line) {
  return line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*');
}

/**
 * Brace-match the body of a `catch (...) {` starting at `braceIndex` (the position of the `{`).
 * Returns the inner body text (without the outer braces). Braces INSIDE strings, template literals,
 * and comments are ignored, so a `}` in a string/comment cannot truncate the body early (which would
 * mis-place the suppression window and false-flag annotated code).
 */
function extractBlockBody(src, braceIndex) {
  let depth = 0;
  let body = '';
  let mode = 'code'; // 'code' | 'line' | 'block' | "'" | '"' | '`'
  for (let i = braceIndex; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    const prev = src[i - 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') mode = 'line';
      else if (ch === '/' && next === '*') mode = 'block';
      else if (ch === "'" || ch === '"' || ch === '`') mode = ch;
      else if (ch === '{') {
        depth += 1;
        if (depth === 1) continue; // skip the outer opening brace
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break; // reached the matching close
      }
    } else if (mode === 'line') {
      if (ch === '\n') mode = 'code';
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') mode = 'code';
    } else if (ch === mode && prev !== '\\') {
      mode = 'code'; // closing quote of the current string/template
    }
    body += ch;
  }
  return body;
}

/** Whether `allow-fallback` on this line sits in a COMMENT (line/JSDoc/block), not a string literal. */
function annotationInComment(line) {
  const trimmed = line.trim();
  return (
    /\/\/[^\n]*allow-fallback/.test(line) || // // allow-fallback…
    /\/\*[^\n]*allow-fallback/.test(line) || //  /* allow-fallback…
    (/^\*/.test(trimmed) && /allow-fallback/.test(trimmed)) // JSDoc continuation ` * …allow-fallback`
  );
}

/**
 * Pure content check: return the no-fallback findings in a source string. Exposed so the harness
 * test can assert the flag/suppress/anti-rot behavior directly, without touching disk.
 *
 * Each finding: `{ file, line, kind, text }`, where kind is one of `unannotated-fallback`,
 * `silent-catch`, `discarded-rejection` or `reasonless-annotation`.
 */
export function findNoFallbackFindingsInSource(source, file = 'fixture.ts') {
  const findings = [];
  const lines = source.split('\n');

  // (1) unannotated silent fallbacks: catch { <default-literal return>, no throw }.
  // Lookbehind `(?<![.\w])` excludes a promise `.catch(fn)` handler and any `…catch`-suffixed
  // identifier — only a statement `try { … } catch { … }` is a swallow candidate.
  const catchRe = /(?<![.\w])catch\s*(\([^)]*\))?\s*\{/g;
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

  // (1b) CORE-029 — the SWALLOW shapes, which v1 excluded and which are the ones the diagnostics
  // audit actually found: a `catch` block whose body says nothing at all, and a promise handler that
  // discards its rejection (`.catch(() => undefined)` and friends). Neither returns a default, so
  // rule (1) never saw them; both make a failed path indistinguishable from a working one, which is
  // exactly what "Silence is not success" forbids.
  //
  // Same escape hatch as (1): an adjacent `allow-fallback: <reason>` declares the degradation.
  const emptyCatchRe = /(?<![.\w])catch\s*(\([^)]*\))?\s*\{/g;
  let emptyMatch;
  while ((emptyMatch = emptyCatchRe.exec(source)) !== null) {
    const braceIndex = emptyMatch.index + emptyMatch[0].length - 1;
    const body = extractBlockBody(source, braceIndex);
    const stmts = body
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => !isCommentOrEmpty(s));
    if (stmts.length > 0) continue; // it does something — rule (1) judges what
    const line = source.slice(0, emptyMatch.index).split('\n').length;
    const closingLine = source.slice(0, braceIndex + body.length + 2).split('\n').length;
    const window = lines.slice(Math.max(0, line - 2), closingLine).join('\n');
    if (ANNOTATION_WITH_REASON.test(window)) continue;
    findings.push({
      file,
      line,
      kind: 'silent-catch',
      text: 'catch { } — the error is discarded with no record and no reason given',
    });
  }

  // `.catch(() => undefined)` / `.catch(() => null)` / `.catch(() => {})` — a rejection thrown away.
  //
  // The parameter list is deliberately permissive. A first cut allowed only `()` and `(_name)`,
  // which missed `.catch((err) => undefined)` and `.catch((error: unknown) => undefined)` — the two
  // most common spellings, and exactly the ones this floor exists to catch. What makes it a discard
  // is the BODY: an arrow that evaluates to `undefined`, `null` or `{}` throws the rejection away
  // whatever it called the parameter it ignored.
  const discardedRejectionRe = /\.catch\(\s*\(?[^)=]*\)?\s*=>\s*(?:undefined|null|\{\s*\})\s*[,)]/g;
  let discardMatch;
  while ((discardMatch = discardedRejectionRe.exec(source)) !== null) {
    const line = source.slice(0, discardMatch.index).split('\n').length;
    const window = lines.slice(Math.max(0, line - 2), line + 1).join('\n');
    if (ANNOTATION_WITH_REASON.test(window)) continue;
    findings.push({
      file,
      line,
      kind: 'discarded-rejection',
      text: `${discardMatch[0]} — the rejection is thrown away with no record and no reason given`,
    });
  }

  // (2) anti-rot: a reason-less `allow-fallback` annotation (v1 = reason-less-only). Only a token in a
  // COMMENT is an annotation — a `allow-fallback` inside a string literal is data, not a suppression.
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
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

export function findNoFallbackFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  // FAIL-CLOSED (HARNESS-052). An absent `packages/` used to yield zero files and therefore
  // `no-fallback scan passed.` — a No-Fallback floor announcing a clean result over source it never
  // opened. A checkout without the governed tree is broken, not clean.
  const missing = SCAN_DIRS.filter((dir) => !existsSync(path.join(root, dir)));
  if (missing.length > 0)
    throw new Error(
      `governed tree(s) absent under ${root}: ${missing.join(', ')}. This scan will not report a ` +
        'pass over source it could not read.',
    );
  for (const dir of SCAN_DIRS) {
    for (const file of walkSource(dir, root)) {
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

  if (process.argv.includes('--write-baseline')) {
    const { counts } = applySwallowBaseline(findings, {});
    const next = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `no-fallback swallow baseline regenerated: ${Object.keys(next).length} file/kind pair(s).`,
    );
    process.exit(0);
  }

  const { failures, ratchet } = applySwallowBaseline(findings, readBaseline());

  if (failures.length === 0) {
    const frozen = Object.keys(readBaseline()).length;
    if (ratchet.length > 0) {
      console.error(
        'no-fallback scan FAILED — a frozen swallow was removed but the baseline still allows it:',
      );
      for (const entry of ratchet) {
        console.error(`  [ratchet-tighten] ${entry.key}: ${entry.frozen} → ${entry.count}`);
      }
      console.error(
        '\nRun `node scripts/harness/scan-no-fallback.mjs --write-baseline` in the SAME change so ' +
          'the ratchet keeps the gain — an unlocked gain is a licence to grow back.',
      );
      process.exit(1);
    }
    console.log(`no-fallback scan passed (${frozen} baselined swallow burn-down entr(y/ies)).`);
    process.exit(0);
  }

  console.error('no-fallback scan FAILED — undeclared silent fallback / reason-less annotation:');
  for (const f of failures) {
    console.error(`  [${f.kind}] ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\nNo Fallback Policy (operational.md): a single, correct, verifiable path.\n' +
      '  - unannotated-fallback: remove the silent catch→default, surface the error, OR — if this\n' +
      '    degradation is genuinely sanctioned — annotate the return with `// allow-fallback: <reason>`.\n' +
      '  - reasonless-annotation: every `allow-fallback` MUST carry a `: <reason>`.\n' +
      '  - silent-catch / discarded-rejection: a swallowed error must not be indistinguishable from\n' +
      '    a working path. Report it, or declare the degradation with `// allow-fallback: <reason>`.\n' +
      "  Intentional fallbacks are also declared in the spec's `## Fallback & Degradation Declaration`.",
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
