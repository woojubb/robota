#!/usr/bin/env node

/**
 * A document that names a file must name one that exists.
 *
 * ## The class
 *
 * The most-repeated defect measured in this repository is prose asserting a property of an artifact
 * the prose is wrong about — and the cheapest, most decidable slice of it is the artifact NOT BEING
 * THERE. A comment that says "`foo.test.mjs` reads both sides" is a claim with a subject, and the
 * subject either exists or it does not.
 *
 * This is deliberately NOT the general contradiction problem (that is a separate, open item). It
 * asks one question a machine can answer: **the file you named — is it there?**
 *
 * ## Why a link scan does not already cover it
 *
 * `resolving-claims` checks markdown LINKS. The instances that keep landing are bare names inside
 * prose and inside source comments: a test file named in a docstring, a scan named in a rule, a hook
 * named in a task. No link, so nothing looked. Measured: a module comment named
 * `mirrors-the-ci-scans-job` while the file was `pre-push-mirrors-ci-scans.test.mjs`, and it was a
 * human who noticed.
 *
 * ## What counts as naming a file
 *
 * A token that carries a repository-file extension and at least one path-ish or word-ish body:
 * `scan-x.mjs`, `foo.test.mjs`, `AGENTS.md`, `ci.yml`. Bare extensions, globs and template slots are
 * not names. A name resolves if a file with that BASENAME exists anywhere in the tree — the claim
 * being checked is "this artifact exists", not "this path is correct", and a stricter reading would
 * fire on every correct relative mention.
 *
 * ## Exemptions, each with a reason
 *
 *  - a fenced code block — a specimen shows a shape, and its names are illustrations;
 *  - a name inside a URL — it belongs to another repository;
 *  - `<!-- allow-missing-artifact: <reason> -->` on the line, reason required — for a document that
 *    is ABOUT a file that should not exist, which is a real case and must not be unwritable.
 *
 * Exit 0 = every named artifact in the examined tree exists.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { EXTENSIONS, hasStem, isTemplateSlot } from './lib/file-name-shape.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** The trees whose prose is governed. Archives are historical and name a tree that has moved on. */
const ROOTS = ['.agents/rules', '.agents/skills', 'scripts/harness', '.claude/hooks'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'completed', 'done', 'rejected', 'archive']);

// The extension list moved to `lib/file-name-shape.mjs`: `hasStem` needs it to tell `.gitignore`
// (a file) from `.ts` (an extension), and this scan needs it to decide what to look for. Two
// questions, one answer — which is the reason that file exists.

/**
 * A name is read only from INSIDE backticks.
 *
 * Loose matching over prose was the first version and it produced 1656 findings from 470 documents:
 * `Next.js` is a `.js` name, `*.test.ts` yields `test.ts`, and a sentence about a framework became a
 * missing file. Every real artifact reference in this repository is code-formatted, so the backticks
 * are not a heuristic — they are how the claim is written, and reading them is what separates naming
 * a file from mentioning a word.
 */
const CODE_SPAN = /`([^`\n]+)`/g;
// A SINGLE-SEGMENT dotfile — `.gitignore`, `.editorconfig` — carries no listed extension and is
// therefore outside this scan's reach. That gap is real; admitting the shape was TRIED and RAN, and
// it produced findings for `.git`, `.agents`, `.husky`, `.turbo` (directories), `.bashrc`,
// `.hookrc` and `.length` (a property access) — correct documents refused. Filed as HARNESS-078
// rather than closed by widening, because a check that fires on correct work gets turned off.
const NAMED = new RegExp(String.raw`^[A-Za-z0-9._/-]+\.(?:${EXTENSIONS.join('|')})$`);
// The reason must contain a WORD. `\S` alone accepted `)` — the closing paren of the marker itself —
// so `(allow-missing-artifact: )` excused the line while saying nothing, which is the shape of every
// suppression this repository regrets. Caught by its own case.
const ALLOW =
  /<!--\s*allow-missing-artifact:\s*([^]*?)-->|allow-missing-artifact:[ \t]*([A-Za-z0-9][^\n]*)/;

/**
 * A FILE-level declaration, for a document whose subject is invented names.
 *
 * The per-line marker is fragile in source: a formatter reflowed one assertion and left the claim on
 * a line of its own with the marker two lines below, so the exemption silently stopped applying and
 * the check fired on the case that proves it works. A file whose fixtures ARE names needs to say so
 * once, where no reflow can separate the saying from the said.
 *
 * It replaces a hardcoded filename this scan used to carry — a list of one, which is the shape that
 * grows into a list of ten nobody can justify.
 */
// `[ \t]`, not `\s`. `\s` crosses a NEWLINE, so an empty declaration swallowed the FOLLOWING line
// as its reason and a marker saying nothing excused the whole file. The same defect had already been
// fixed one function below for the per-line marker, and it came back the moment the shape was copied
// — which is the argument for reading the reason on the marker's own line, both times.
const ALLOW_FILE = /allow-missing-artifact-file:[ \t]*([A-Za-z0-9][^\n]*)/;

export function fileIsExempt(source) {
  const match = ALLOW_FILE.exec(source);
  return Boolean(match && match[1].trim());
}

export function hasAllowedReason(line) {
  const match = ALLOW.exec(line);
  if (!match) return false;
  return Boolean((match[1] ?? match[2] ?? '').trim());
}

/** A token that names a FORM rather than a file. Both owned by `lib/file-name-shape.mjs`. */
export { hasStem, isTemplateSlot };

/**
 * Names claimed by one document, with the lines they sit on.
 *
 * `insideUrl` is checked per-match rather than per-line: a line may carry a real name beside a URL,
 * and dropping the whole line would excuse the real one.
 */
export function findNamedArtifacts(source) {
  if (fileIsExempt(source)) return [];
  const found = [];
  let inFence = false;

  source.split('\n').forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence || hasAllowedReason(line)) return;

    CODE_SPAN.lastIndex = 0;
    let match;
    while ((match = CODE_SPAN.exec(line)) !== null) {
      const name = match[1].trim();
      if (!NAMED.test(name) || isTemplateSlot(name) || !hasStem(name)) continue;
      // A name inside a URL belongs to another repository.
      const before = line.slice(0, match.index);
      if (/https?:\/\/\S*$/.test(before)) continue;
      found.push({ name, line: index + 1, text: line.trim().slice(0, 120) });
    }
  });

  return found;
}

/** Every file BASENAME the repository contains. */
export function repositoryBasenames(root = WORKSPACE_ROOT) {
  const names = new Set();
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // `.git` EXACTLY. `startsWith('.git')` also skipped `.github`, so every workflow file was
      // absent from the index and every correct mention of `ci.yml` read as a broken name — a check
      // firing on correct data, found by running it over the real tree.
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      names.add(entry.name);
    }
  };
  walk(root, 0);
  return names;
}

function documents(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && entry.name !== '.git') walk(full);
        continue;
      }
      if (/\.(md|mjs|sh)$/.test(entry.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Names already known not to resolve, frozen so the set can FALL and never RISE.
 *
 * A flat gate was the first design and it was wrong for an honest reason: most of what this finds is
 * ILLUSTRATIVE — `src/ghost.ts`, `packages/pkg-a/src/old.ts`, `foo.test.mjs` — names invented to
 * explain a rule, which a machine cannot tell from a claim about a real artifact. Annotating 88 of
 * them would be churn against documents that are correct.
 *
 * The ratchet keeps the property that matters. What this defect actually looks like is a name that
 * STOPS resolving because a change renamed or deleted its subject, and that is a new entry — which
 * fails. An entry that disappears must leave the baseline in the same change, so a fix cannot be
 * quietly re-spent.
 */
export const BASELINE_PATH = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/named-artifact-baseline.json',
);

export function readBaseline(file = BASELINE_PATH) {
  if (!existsSync(file)) return null;
  return new Set(JSON.parse(readFileSync(file, 'utf8')));
}

/** `<file> -> <name>`: the pair, because the same illustrative name is fine in one place and not another. */
export function baselineKey(finding) {
  return `${finding.file} -> ${finding.name}`;
}

export function judgeAgainstBaseline(findings, frozen) {
  const seen = new Set(findings.map(baselineKey));
  return {
    unfrozen: findings.filter((finding) => !frozen.has(baselineKey(finding))),
    stale: [...frozen].filter((key) => !seen.has(key)),
  };
}

export function scanNamedArtifacts(root = WORKSPACE_ROOT) {
  const present = repositoryBasenames(root);
  // Fail closed: a sweep that found no files to compare against would call every name broken, or —
  // worse, if the comparison were inverted — call every name fine.
  if (present.size === 0) throw new Error(`named-artifact-resolves: no files found under ${root}.`);

  const findings = [];
  let examined = 0;

  for (const relativeRoot of ROOTS) {
    const full = path.join(root, relativeRoot);
    if (!existsSync(full) || !statSync(full).isDirectory()) {
      throw new Error(`named-artifact-resolves: ${relativeRoot} does not exist under ${root}.`);
    }
    for (const file of documents(full)) {
      examined += 1;
      const source = readFileSync(file, 'utf8');
      for (const claim of findNamedArtifacts(source)) {
        if (present.has(path.basename(claim.name))) continue;
        findings.push({ file: path.relative(root, file), ...claim });
      }
    }
  }

  return { findings, examined };
}

function main() {
  const { findings, examined } = scanNamedArtifacts();
  console.log(`::examined:: ${examined} governed documents`);

  const frozen = readBaseline();
  // Fail closed: with no baseline every name is unfrozen, and a scan that cannot read its own
  // reference point must say so rather than report the whole tree as broken.
  if (frozen === null) {
    console.error(
      `named-artifact-resolves: no baseline at ${path.relative(WORKSPACE_ROOT, BASELINE_PATH)}.`,
    );
    process.exitCode = 1;
    return;
  }

  const { unfrozen, stale } = judgeAgainstBaseline(findings, frozen);

  if (unfrozen.length > 0) {
    console.error(
      `named-artifact-resolves scan failed: ${unfrozen.length} NEW name(s) resolve to nothing:`,
    );
    for (const finding of unfrozen) {
      console.error(`  - ${finding.file}:${finding.line} -> ${finding.name}`);
      console.error(`      ${finding.text}`);
    }
    console.error(
      '\nName the file that exists, or — if the document is ABOUT a file that should not exist — ' +
        'declare it with `allow-missing-artifact: <reason>` on the line.',
    );
    process.exitCode = 1;
    return;
  }

  if (stale.length > 0) {
    console.error(
      `named-artifact-resolves scan failed: ${stale.length} baseline entr(y/ies) no longer occur:`,
    );
    for (const key of stale) console.error(`  - ${key}`);
    console.error(
      '\nA name that now resolves leaves the baseline in the SAME change, or the gain is spendable twice.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `named-artifact-resolves scan passed (${examined} document(s); ${frozen.size} name(s) baselined, ` +
      'no new ones). The baseline is a burn-down: it may fall, never rise.',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
