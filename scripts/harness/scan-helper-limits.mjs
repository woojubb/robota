#!/usr/bin/env node

/**
 * Mechanical floor for [helper-limits.md](../../.agents/rules/helper-limits.md): a helper's stated
 * limits are re-judged at every consumer whose consequences differ.
 *
 * ## The class this fences
 *
 * A shared function's documented limits were judged against what its FIRST consumer did with the
 * answer. When a second consumer arrives with heavier consequences, the function does not change —
 * so nothing in the diff signals anything, and review sees a reuse, which reads as good practice.
 * The defect is invisible in the code and appears only in behaviour. Two instances, one session:
 *
 * - `git()` trimmed its output, which is right for a sha and wrong for a patch. Reused to produce
 *   the input to `git apply -R`, it stripped the final newline and git called every patch corrupt —
 *   so the red-proof gate's mutation step threw for its entire life (twelve CI runs, zero verdicts).
 * - `testExecutesHook` was written as a grep-level relation for an ADVISORY coverage floor, whose
 *   own docstring called it "structural rather than exact". Reused to pick which tests may set a
 *   red-proof VERDICT, the same imprecision can hand a verdict to a test that never ran the hook
 *   (INFRA-074).
 *
 * ## The contract
 *
 * An exported function may declare its limits with a `@limits <statement>` line in its docblock.
 * Doing so is opt-in — this floor does not demand that every helper be annotated, because a blanket
 * requirement would be satisfied by boilerplate and would say nothing.
 *
 * What it does demand: **every module that imports a `@limits` function carries an acknowledgement**
 * naming it —
 *
 *     // LIMITS testExecutesHook: only an advisory message rides on this, so approximate is enough.
 *
 * or, when they do NOT hold and the mismatch is being held rather than fixed, a containment naming a
 * root item (`finding-depth.md`):
 *
 *     // LIMITS testExecutesHook: CONTAINMENT — INFRA-074, held until the gate becomes enforcing.
 *
 * The point is not the comment. It is that the question was ASKED at the site where the consequences
 * are known, which is the only place it can be answered.
 *
 * ## Anti-rot
 *
 * A `@limits` tag with no statement, and a `LIMITS <name>:` with no reason, both FAIL — the same
 * convention `allow-fake` and `allow-fallback` use. A marker that says nothing is a marker that
 * stops being read.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Subjects scanned. Shell hooks have no import graph, so this is the JS side of the harness. */
export const SUBJECT_DIRS = ['scripts/harness'];

/** Every `@limits`-tagged exported function in `text`, as `{ name, statement }`. */
export function taggedFunctions(text) {
  const found = [];
  // A docblock immediately preceding an `export function`. Deliberately positional: a `@limits` line
  // floating anywhere in a file would let the tag drift away from what it describes.
  // Anchored at line start, and that is not cosmetic: a fixture inside a string literal — which is
  // what a test of this very scan is full of — otherwise reads as a real declaration. Real code
  // declares its exports in column zero; quoted text never does.
  // The block may not run past a `*/`: without that, a lazy match starting at the module docblock
  // swallows everything down to the first documented export and adopts any `@limits` the file
  // merely TALKS about — including this one's own contract prose.
  const re = /(?:^|\n)\/\*\*\n((?:(?!\*\/)[\s\S])*?)\n \*\/\nexport function ([A-Za-z0-9_$]+)/g;
  for (const m of text.matchAll(re)) {
    const [, block, name] = m;
    const tag = block.match(/@limits[ \t]*(.*)/);
    if (!tag) continue;
    found.push({ name, statement: tag[1].trim() });
  }
  return found;
}

/** Local module specifiers imported by `text`, with the names taken from each. */
export function localImports(text) {
  const out = [];
  // A default binding may precede the braces, and the specifier may be quoted either way. Neither
  // is common here — prettier settles the quotes — but a floor that MISSES a consumer fails
  // silently, which is the invisible-in-the-code shape this whole rule exists to catch.
  const re = /(?:^|\n)import\s+(?:[A-Za-z0-9_$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"](\.[^'"]*)['"]/g;
  for (const m of text.matchAll(re)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    out.push({ specifier: m[2], names });
  }
  return out;
}

/** Acknowledgements present in `text`, as `{ name, reason }` — comment-scoped, like `allow-fake`. */
export function acknowledgements(text) {
  const out = [];
  for (const m of text.matchAll(
    /(?:^|\n)[ \t]*(?:\/\/|\*)[ \t]*LIMITS[ \t]+([A-Za-z0-9_$]+)[ \t]*:(.*)/g,
  )) {
    out.push({ name: m[1], reason: m[2].trim() });
  }
  return out;
}

/**
 * The whole decision, over a `{ [repoRelativePath]: text }` map — pure, so the contract is testable
 * without a tree to walk.
 */
export function analyze(files) {
  const findings = [];
  const tagged = new Map(); // absolute-ish module path → [{name, statement}]

  for (const [file, text] of Object.entries(files)) {
    const fns = taggedFunctions(text);
    if (fns.length > 0) tagged.set(file, fns);
    for (const fn of fns) {
      if (fn.statement === '') {
        findings.push({
          file,
          message: `@limits on ${fn.name} states nothing — a marker that says nothing stops being read`,
        });
      }
    }
  }

  // Keyed by MODULE and name, not by name alone. `analyze`, `main` and `walk` are ordinary names in
  // this directory; resolving an owner by name would let an unrelated import demand the wrong file's
  // limits, or let an acknowledgement of an unrelated function silently excuse the real one — the
  // invisible-in-the-code failure this rule exists to catch, reproduced by its own enforcement.
  const ownerHas = new Set();
  for (const [file, fns] of tagged) for (const fn of fns) ownerHas.add(`${file}\u0000${fn.name}`);
  const taggedCount = ownerHas.size;

  for (const [file, text] of Object.entries(files)) {
    const acked = acknowledgements(text);
    for (const ack of acked) {
      if (ack.reason === '') {
        findings.push({
          file,
          message: `LIMITS ${ack.name} carries no reason — say why they hold here, or name the containment`,
        });
      }
    }
    const ackedNames = new Set(acked.map((a) => a.name));

    for (const imp of localImports(text)) {
      const owner = resolveSpecifier(file, imp.specifier);
      for (const name of imp.names) {
        // Only the declaring module's own name counts: a same-named export elsewhere is a different
        // function, and the file that DECLARES it needs no acknowledgement of itself.
        if (!owner || owner === file || !ownerHas.has(`${owner}\u0000${name}`)) continue;
        if (!ackedNames.has(name)) {
          findings.push({
            file,
            message:
              `imports ${name}, whose limits are declared in ${owner}, without acknowledging them. ` +
              `Add \`// LIMITS ${name}: <why they hold here>\` — or, if they do not hold, a ` +
              'containment naming a root item.',
          });
        }
      }
    }
  }

  // Fail-closed against parser drift. Declaring is opt-in, so examining nothing is legitimate while
  // nobody has tagged anything — but zero matches while the tag string IS present in the subject
  // means the READER broke, and a reader that reads nothing reports a clean sweep. That is the
  // twelve-green-runs-zero-verdicts shape, in the floor written because of it.
  if (taggedCount === 0) {
    const withTagText = Object.keys(files).filter((f) => files[f].includes('@limits'));
    if (withTagText.length > 0) {
      findings.push({
        file: withTagText[0],
        message:
          `the text contains @limits in ${withTagText.length} file(s) and the parser matched none — ` +
          'the reader has drifted, and a reader that reads nothing reports a clean sweep',
      });
    }
  }

  return { findings, examined: taggedCount };
}

/** A relative specifier resolved to a repo-relative module path, or null when it is not local. */
export function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.mjs')) out.push(full);
  }
  return out;
}

function main() {
  const files = {};
  for (const rel of SUBJECT_DIRS) {
    for (const full of walk(path.join(WORKSPACE_ROOT, rel))) {
      files[path.relative(WORKSPACE_ROOT, full)] = readFileSync(full, 'utf8');
    }
  }

  const { findings, examined } = analyze(files);

  // Measured, never silent: a run that examined nothing is reported as such rather than reading as
  // a clean sweep — the distinction between "examined and clean" and "examined nothing".
  console.log(
    `helper-limits: ${examined} @limits-tagged function(s) across ${Object.keys(files).length} file(s).`,
  );
  if (findings.length === 0) {
    process.exit(0);
  }
  for (const f of findings) console.error(`✗ ${f.file}: ${f.message}`);
  console.error(
    `\nhelper-limits: ${findings.length} finding(s). A helper's limits were judged against its ` +
      "first consumer's consequences; a consumer with different consequences has to judge them again.",
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
