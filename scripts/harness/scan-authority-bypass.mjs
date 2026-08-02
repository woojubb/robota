#!/usr/bin/env node

/**
 * A declared AUTHORITY must be the only source of the values it governs.
 *
 * When a codebase says "X is the single place that decides Y" — a state machine that owns the legal
 * transitions, a resolver that owns permission outcomes, a factory that owns identifiers — the claim
 * is only true if nothing writes Y from a literal. One literal that happens to be legal today is not
 * a bug; it is the moment the authority stopped being the authority, and it is invisible because the
 * value is correct.
 *
 * WHY THIS EXISTS, measured. In one change (DAG-001, PR #1600) the same defect appeared FIVE times
 * across eight review rounds. Each time a comment asserted "the table stays the single place legal
 * transitions live" while a sibling line wrote a status literal past it. Each time it was found by a
 * human reader, fixed at that one site, and reappeared at the next. The fourth round fixed a literal
 * `'cancelled'`; the fifth found two literal `'failed'` writes in the same function, untouched. A
 * rule that only a careful reader enforces is a rule that recurs, so this is the mechanical form of
 * it: what a comment asserted, a scan now decides.
 *
 * NEUTRAL BY CONSTRUCTION. This engine knows nothing about any domain. It reads its pairs from
 * `.agents/harness.config.json` → `authorityBypass`, each entry naming a writer function, the
 * argument position that carries the governed value, and the authority the value must come from.
 * A different repository points it at its own pairs and changes no code here.
 *
 * WHAT IT CANNOT DO, stated so nobody reads more into a pass than it means: this is a syntactic
 * check. It sees a literal in the governed position. A value laundered through a variable, a helper,
 * or a cast passes — so a green here means "no literal reaches the writer directly", not "the
 * authority is respected". Widening it to follow data flow is a different tool; a check that
 * overstates its reach is the failure mode this repo already measures as vacuity.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

/** A call to `name(` with its argument text, ignoring nesting inside the arguments. */
function findCalls(source, name) {
  const calls = [];
  const needle = `${name}(`;
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) return calls;
    from = at + needle.length;
    // Reject a longer identifier that merely ends with the name (`myUpdateTaskRunStatus(`).
    const before = source[at - 1] ?? '';
    if (/[\w$]/.test(before) && before !== '.') continue;
    // Skip STRING CONTENT while counting. Without this a literal containing an unbalanced `)` — a
    // message, a regex, a path — closes the call early and the governed argument is read from
    // truncated text. A parser that mis-reads silently is the failure mode this scan exists to end,
    // so it must not have it itself.
    let depth = 1;
    let i = from;
    let quote = '';
    for (; i < source.length && depth > 0; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== '\\') quote = '';
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    calls.push({ index: at, args: source.slice(from, i - 1) });
  }
}

/** Split an argument list on top-level commas — nested calls, objects and arrays stay intact. */
function splitArgs(args) {
  const out = [];
  let depth = 0;
  let current = '';
  let quote = '';
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      current += ch;
      if (ch === quote && args[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const STRING_LITERAL = /^(['"`])[^'"`]*\1$/;

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

export function findAuthorityBypasses(files, rules, readFile = (f) => readFileSync(f, 'utf8')) {
  const findings = [];
  for (const file of files) {
    const source = readFile(file);
    for (const rule of rules) {
      if (!source.includes(`${rule.writer}(`)) continue;
      for (const call of findCalls(source, rule.writer)) {
        const arg = splitArgs(call.args)[rule.argumentIndex];
        if (arg === undefined || !STRING_LITERAL.test(arg)) continue;
        findings.push({
          file,
          line: lineOf(source, call.index),
          writer: rule.writer,
          literal: arg,
          authority: rule.authority,
          reason: rule.reason,
        });
      }
    }
  }
  return findings;
}

/** Every source file under the configured scopes. */
function collectFiles(root, scopes) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    }
  };
  for (const scope of scopes) {
    const dir = path.join(root, scope);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

function main() {
  const root = process.cwd();
  const rules = loadHarnessConfig().authorityBypass ?? [];
  if (rules.length === 0) {
    // Declared-and-empty is a real configuration, but it must not read as a pass over governed
    // ground — that is the vacuity shape this repo has already measured across its own suite.
    console.log(
      'authority-bypass scan: NO RULES CONFIGURED (.agents/harness.config.json) — nothing was checked.',
    );
    return;
  }

  const scopes = [...new Set(rules.flatMap((rule) => rule.scope ?? []))];
  // Fail closed on a scope that is not there: a rule pointed at a directory this checkout does not
  // have would otherwise examine nothing and report a pass.
  requireGovernedTree(root, scopes, {
    scan: 'scan-authority-bypass',
    why: 'Each configured authority rule names the scope it governs.',
  });
  const files = collectFiles(root, scopes);

  const findings = findAuthorityBypasses(files, rules);
  if (findings.length === 0) {
    console.log(
      `authority-bypass scan passed (${files.length} file(s), ${rules.length} authority rule(s)).`,
    );
    return;
  }

  console.error(`authority-bypass scan failed: ${findings.length} finding(s):`);
  for (const finding of findings) {
    const rel = path.relative(process.cwd(), finding.file);
    console.error(
      `- [authority-bypass] ${rel}:${finding.line}: \`${finding.writer}\` is given the literal ` +
        `${finding.literal}. ${finding.reason} Derive it from \`${finding.authority}\` instead.`,
    );
  }
  console.error(
    '\nA literal that is legal today is not a bug; it is the moment the authority stopped being the ' +
      'authority, and it is invisible because the value is correct.',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
