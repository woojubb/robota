#!/usr/bin/env node

/**
 * The harness must not hardcode the scope it is configured with.
 *
 * WHY THIS EXISTS, and why a scan rather than another sweep (HARNESS-067). A completed audit named
 * NON-NEUTRALITY its **dominant finding** — "Robota package names baked into machinery that presents
 * as a general, portable harness" — and prescribed "move repo-specifics to config, keep the machinery
 * generic". The diet finished on 2026-07-24. On 2026-08-02 an outside reader evaluating this harness
 * for adoption found the clearest possible form of it still present, both idioms **in one file**:
 *
 *     if (dep.startsWith(HARNESS.npmScopePrefix) && …)                    // reads config
 *     const reexportPattern = /export\s+\*\s+from\s+['"](@robota-sdk\/…)/ // four lines away
 *
 * The sweep already happened. A recurring mistake is not closed by fixing the instance.
 *
 * HOW IT FAILS, which is the reason it matters. A hardcoded scope does not break when the scope
 * changes — it matches NOTHING. The rule reports zero violations and the run is green. That is
 * HARNESS-064's vacuity arriving through a different door, and it is invisible in this repository
 * precisely because the hardcoded value happens to be correct here.
 *
 * WHAT IT CHECKS. The configured `npmScopePrefix` must not appear in the CODE of a harness script.
 * Comments are excluded deliberately: a rule's docstring has to be able to say which packages it is
 * about, and counting prose would make this unlandable and get it suppressed rather than obeyed.
 * String literals ARE code here — an allowlist keyed by package name is exactly the thing that should
 * be built from the configured scope.
 *
 * A RATCHET, NOT A BAN. 96 occurrences across 15 scripts cannot be removed in one change. The
 * per-file count is frozen: it may fall and must never rise, and every script already at zero is
 * protected outright by the same rule.
 *
 * That number moved three times during review — 77 → 88 → 96 — never because anything was added, but
 * because each hand-rolled version of the counter could not see a form the literal takes. Written
 * from the frozen file rather than from memory, which is the mistake this docstring made once: a scan
 * whose subject is silent drift had drifted.
 *
 * IT KNOWS ITS OWN SCOPE FROM CONFIG. Hardcoding the literal here would make this scan an instance of
 * what it checks; it reads `.agents/harness.config.json` like the scripts it governs, so a repository
 * with a different scope gets a working check and changes no code.
 *
 * WHAT IT CANNOT DO: it counts a literal, not coupling. A script that reads the scope from config and
 * then assumes this repository's package layout scores zero and is no more portable.
 *
 * FAIL-CLOSED: the config must declare a scope and the script directory must exist. A run that could
 * not read either says so rather than passing.
 *
 * Exit code 0 = no script exceeds its frozen count, 1 = one grew, or a count fell without re-freezing.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ScriptTarget, SyntaxKind, createSourceFile, forEachChild } from './lib/ts-ast.mjs';

import { loadHarnessConfig } from './harness-config.mjs';
import { harnessScripts, resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const SCRIPT_DIR = 'scripts/harness';
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/scope-literal-baseline.json');

/**
 * Source with comments removed.
 *
 * Comments are the one place the scope legitimately appears — a rule that governs `@scope/foo` has to
 * be able to name it when explaining itself. Strings are NOT removed: an allowlist keyed by package
 * name is code, and is exactly what should be composed from the configured prefix.
 */
/**
 * The scope occurrences that are CODE, counted by parsing.
 *
 * Three hand-rolled versions of this got it wrong, each the same way and each found by review rather
 * than by reading:
 *
 * 1. `[^:]\/\/` treated the `//` inside `'//host/@scope/pkg'` as a comment and deleted the rest of
 *    the line.
 * 2. Walking quotes per LINE fixed that, but a `/*`-shaped substring inside a string was still
 *    stripped first by a separate, string-unaware pass.
 * 3. A single-pass scanner carrying quote state across lines fixed both — and then desynchronised on
 *    this repository's own `shared.mjs`, leaving a whole line comment in the count.
 *
 * None produced a wrong number. Each produced an INVISIBLE ZERO or a phantom one, which is precisely
 * the failure mode this ratchet exists to prevent. The repository already made this decision once:
 * `scan-contract-cast-ratchet` replaced a hand-rolled scanner with the native-AST adapter after three
 * silent under-counts, and the same answer applies here. A parser has no such ambiguities — comments
 * are not nodes, and a delimiter inside a string is just text.
 *
 * What counts: the text of string, template and regex literals. That is what "code, not prose" means
 * for this rule — an allowlist keyed by package name is code; a docstring naming the scope a rule
 * governs is not. An identifier cannot contain `@`, so nothing else can carry the literal.
 */
export function codeOnly(source) {
  const ast = createSourceFile('scan.mjs', source, ScriptTarget.Latest, true);
  const parts = [];
  const visit = (node) => {
    const kind = node.kind;
    if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === SyntaxKind.TemplateHead ||
      kind === SyntaxKind.TemplateMiddle ||
      kind === SyntaxKind.TemplateTail ||
      kind === SyntaxKind.RegularExpressionLiteral
    ) {
      parts.push(node.getText(ast));
    }
    forEachChild(node, visit);
  };
  visit(ast);
  // Inside a REGEX literal the scope is written `@scope\/…` — the form the audit isolated. A counter
  // that could not see it would have missed the instance it exists for.
  return parts.join('\n').replace(/\\\//g, '/');
}

/** Occurrences of the scope literal in each script's code, by file name. */
export function countScopeLiterals(dir, scope, files = harnessScripts(dir)) {
  const counts = {};
  for (const name of files.filter((file) => file.endsWith('.mjs'))) {
    const occurrences =
      codeOnly(readFileSync(path.join(dir, name), 'utf8')).split(scope).length - 1;
    if (occurrences > 0) counts[name] = occurrences;
  }
  return counts;
}

export function findScopeLiteralFindings(root = WORKSPACE_ROOT, scope = configuredScope()) {
  if (typeof scope !== 'string' || scope === '') {
    // Fail closed: with no configured scope there is nothing to compare against, and reporting a
    // clean result would be a claim about ground never examined.
    throw new Error(
      'harness-scope-literal: no `npmScopePrefix` in .agents/harness.config.json — the scope the ' +
        'scripts must not hardcode is unknown, so nothing could be checked.',
    );
  }
  const dir = path.join(root, SCRIPT_DIR);
  if (!existsSync(dir)) {
    throw new Error(
      `harness-scope-literal: ${SCRIPT_DIR} does not exist under ${root} — no scripts could be read.`,
    );
  }
  return { counts: countScopeLiterals(dir, scope), scope };
}

function configuredScope() {
  return loadHarnessConfig().npmScopePrefix;
}

function loadBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : undefined;
}

function main() {
  const { counts, scope } = findScopeLiteralFindings();
  const baseline = loadBaseline();
  if (baseline === undefined) {
    console.error('harness-scope-literal: no frozen baseline — run --write-baseline.');
    process.exitCode = 1;
    return;
  }

  const grown = [];
  const shrunk = [];
  for (const [name, count] of Object.entries(counts)) {
    const frozen = baseline[name] ?? 0;
    if (count > frozen) grown.push({ name, count, frozen });
  }
  for (const [name, frozen] of Object.entries(baseline)) {
    const count = counts[name] ?? 0;
    if (count < frozen) shrunk.push(`${name}: ${frozen} → ${count}`);
  }

  if (grown.length > 0) {
    console.error(`harness-scope-literal ratchet failed: ${grown.length} finding(s):`);
    for (const { name, count, frozen } of grown) {
      console.error(
        `- [scope-literal-grew] ${name}: ${count} occurrence(s) of \`${scope}\` in code, up from a ` +
          `frozen ${frozen}. Build it from \`HARNESS.npmScopePrefix\` — a hardcoded scope does not ` +
          'fail when the scope changes, it matches nothing, and that reads as a pass.',
      );
    }
    process.exitCode = 1;
    return;
  }
  if (shrunk.length > 0) {
    console.error(
      `harness-scope-literal: the count FELL (${shrunk.join(', ')}). Re-freeze it in the SAME ` +
        'change — `node scripts/harness/scan-harness-scope-literal.mjs --write-baseline` — or the ' +
        'gain is a licence to grow back.',
    );
    process.exitCode = 1;
    return;
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log(
    `harness-scope-literal ratchet passed (${Object.keys(counts).length} script(s) still hardcode ` +
      `\`${scope}\`, ${total} occurrence(s) at baseline).`,
  );
}

function writeBaseline() {
  const { counts } = findScopeLiteralFindings();
  if (Object.keys(counts).length === 0) {
    // An empty baseline would be indistinguishable from a misconfigured scan.
    console.log('harness-scope-literal: nothing hardcodes the scope — freezing an empty baseline.');
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`scope-literal baseline frozen: ${JSON.stringify(counts)}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
