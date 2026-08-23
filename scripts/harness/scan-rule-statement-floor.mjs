#!/usr/bin/env node
/**
 * HARNESS-117 (issue #2178) — a rule that is ENFORCED still has a STATEMENT somebody can read.
 *
 * ## The defect
 *
 * `.agents/project-structure.md` § Interface Package Rule owns five mandatory rules. Delete all five
 * and `pnpm harness:scan` stays green: the scans enforcing them read the CODE, and none of them
 * verifies that the document claiming to own a rule still states it. `routing-document-size` reads
 * the file but ratchets on line COUNT, and a deletion moves that in the permitted direction.
 *
 * It happened during ARCH-100: a slice-based extraction took the span between two anchors and a
 * pre-existing `Rules:` block sat inside it. What caught it was `routing-document-size` going red
 * because the same change also ADDED lines — a size check reporting a content loss by accident. Delete
 * the same rules while removing lines elsewhere and nothing speaks.
 *
 * ## The unit, which is the whole design
 *
 * **A SCAN FILE IS NOT THE UNIT OF ENFORCEMENT; A RULE IDENTIFIER IS.** That sentence is here because
 * two earlier designs were built and measured before it was true to anyone:
 *
 *   1. "every registered scan is named by some tracked document" — 133/140, 95.0% adoption, and it
 *      would NOT have caught the incident: the interface scans are also named in `.agents/archive/`
 *      and `spec-docs/done/`, which record what was decided, not what binds.
 *   2. "…named by a NORMATIVE document" — 47.9%, red on the right file, and STILL missed the actual
 *      deletion: `check-dependency-direction.mjs` implements many rules and stays named by three other
 *      rule documents after the Interface Package Rule is gone.
 *
 * Both were green for a property of the corpus rather than of the rule. Binding the identifier is red
 * exactly where the incident was: `INTERFACE-DEPS` is stated in ONE normative document.
 *
 * ## What it examines
 *
 * Rule identifiers harness scans emit in their findings (`[INTERFACE-DEPS]`, `[PLUGIN-LAYER]`, …),
 * matched against documents that STATE rules now — `.agents/rules/`, `.agents/specs/`,
 * `.agents/skills/`, `.agents/project-structure.md`, `AGENTS.md`, `ARCHITECTURE.md`, `CLAUDE.md`.
 * Archived paths and completed spec-docs are deliberately NOT normative: accepting them is what made
 * design 1 green for the wrong reason.
 *
 * ## What it does NOT claim
 *
 * It checks that a statement EXISTS, not that the statement is correct, current, or says what the
 * scan enforces. A rule whose text drifted from its mechanism passes here. Saying so is part of the
 * check: a floor that lets itself be read as a ceiling is worse than no floor.
 *
 * Exit 0 = every emitted identifier is either stated or frozen in the baseline.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = path.join(ROOT, 'scripts/harness/rule-statement-baseline.json');

/**
 * A rule identifier as a scan PRINTS it: `[UPPER-CASE-WITH-HYPHENS]`. Requires at least one hyphen,
 * which is what separates a rule name from a log level (`[WARN]`) or a bare word.
 */
const IDENTIFIER = /\[([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\]/g;

/** Log levels and diagnostic tags that share the shape but name no rule. */
const NOT_A_RULE = new Set([
  'TODO',
  'FIXME',
  'NOTE',
  'WARN',
  'INFO',
  'PASS',
  'FAIL',
  'DEBUG',
  'ERROR',
]);

/**
 * Documents that STATE rules now. Archives and completed spec-docs are excluded on purpose — they
 * record what was once decided, and treating them as normative is exactly the defect this scan
 * exists to catch, one level up.
 */
export function isNormativeDoc(rel) {
  if (rel.includes('/archive/')) return false;
  if (rel.startsWith('.agents/spec-docs/')) return false;
  return (
    rel.startsWith('.agents/rules/') ||
    rel.startsWith('.agents/specs/') ||
    rel.startsWith('.agents/skills/') ||
    rel === '.agents/project-structure.md' ||
    rel === 'AGENTS.md' ||
    rel === 'ARCHITECTURE.md' ||
    rel === 'CLAUDE.md'
  );
}

/**
 * The text a source EMITS: the contents of its string and template literals.
 *
 * `scan-measurement-provenance.mjs` exports `stripNonCode`, which was the obvious thing to reuse and
 * is the wrong tool here — it keeps executable STRUCTURE and discards string contents, which is
 * exactly where an emitted identifier lives. Reusing it made this scan report zero identifiers and
 * pass, which is a green for the wrong reason and the defect this scan exists to catch.
 *
 * So this walks the source once, keeping literal contents and discarding comments and
 * regular-expression literals. A regex must be discarded and cannot be told from division by shape
 * alone, so the decision is made the way a lexer makes it: by what token preceded the `/`.
 */
export function emittedText(source) {
  let out = '';
  let i = 0;
  let prev = '';
  const isRegexPosition = () =>
    prev === '' ||
    /[=(,:[!&|?{};+\-*%<>~^]$/.test(prev) ||
    /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/.test(prev);
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        out += source[i];
        i += 1;
      }
      i += 1;
      out += '\n';
      prev = 'x';
      continue;
    }
    if (c === '/' && isRegexPosition()) {
      i += 1;
      let inClass = false;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) break;
        i += 1;
      }
      i += 1;
      prev = 'x';
      continue;
    }
    if (!/\s/.test(c)) prev = (prev + c).slice(-12);
    i += 1;
  }
  return out;
}

/**
 * Rule identifiers a scan source emits. PURE over text, so a test needs no repository.
 *
 * Two filters, each added because a measured run reported something that names no rule:
 *
 *  - only EMITTED text is searched (see `emittedText`), so `[SOME-123]` in a documentation comment
 *    is a specimen of a form rather than a claim about a rule, and `[A-Z0-9]` inside a pattern is
 *    not a rule anybody enforces;
 *  - every hyphen-separated SEGMENT must be at least two characters, which tells the rule
 *    `RE-EXPORT` from a character range like `A-Z` that survives inside a string.
 */
export function findEmittedIdentifiers(source) {
  const found = new Set();
  for (const m of emittedText(source).matchAll(IDENTIFIER)) {
    const id = m[1];
    if (NOT_A_RULE.has(id)) continue;
    if (id.split('-').some((segment) => segment.length < 2)) continue;
    found.add(id);
  }
  return [...found].sort();
}

/**
 * Which identifiers no document states. PURE: `docs` is a plain {path: text} map, so the archive
 * exclusion is testable without a checkout.
 */
export function findUnstatedIdentifiers(emitted, docs) {
  const normative = Object.entries(docs).filter(([rel]) => isNormativeDoc(rel));
  const unstated = [];
  for (const [id, scan] of Object.entries(emitted)) {
    const stated = normative.some(([, text]) => text.includes(id));
    if (!stated) unstated.push({ id, scan });
  }
  return unstated.sort((a, b) => a.id.localeCompare(b.id));
}

/** Exported so a test can read the size this scan reports (`measurement-provenance.md`). */
export function readExaminedIdentifierCount(emitted) {
  return Object.keys(emitted).length;
}

/** Every tracked file matching a glob, via git so no symlink is ever followed. */
function trackedFiles(...globs) {
  return execFileSync('git', ['ls-files', ...globs], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

/** Collect identifiers from every harness scan source, keyed to the file that emits each. */
export function collectEmitted(files = trackedFiles('scripts/harness/*.mjs')) {
  const emitted = {};
  for (const rel of files) {
    if (rel.includes('__tests__')) continue; // a fixture's `[SOME-123]` names no rule
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const id of findEmittedIdentifiers(src)) {
      if (!emitted[id]) emitted[id] = rel;
    }
  }
  return emitted;
}

function main() {
  const emitted = collectEmitted();
  const docs = Object.fromEntries(
    trackedFiles('*.md', '**/*.md')
      .filter(isNormativeDoc)
      .map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')]),
  );

  const unstated = findUnstatedIdentifiers(emitted, docs);
  const baseline = existsSync(BASELINE)
    ? JSON.parse(readFileSync(BASELINE, 'utf8'))
    : { frozen: {}, reason: '' };
  const frozen = new Set(Object.keys(baseline.frozen ?? {}));

  const newlyUnstated = unstated.filter((u) => !frozen.has(u.id));
  const nowStated = [...frozen].filter((id) => !unstated.some((u) => u.id === id));

  console.log(
    `::examined:: ${readExaminedIdentifierCount(emitted)} rule identifiers across ` +
      `${Object.keys(docs).length} normative documents`,
  );
  console.log(
    `- [note] ${unstated.length} identifier(s) unstated; ${frozen.size} frozen in ` +
      `${path.relative(ROOT, BASELINE)}. A frozen entry is enforcement with no readable statement — ` +
      `debt, counted here rather than hidden.`,
  );

  const findings = [];
  for (const u of newlyUnstated) {
    findings.push(
      `\`${u.id}\` is emitted by ${u.scan} but no normative document states it. ` +
        `A rule nobody can cite cannot be argued with, amended, or complied with deliberately.`,
    );
  }
  for (const id of nowStated) {
    findings.push(
      `\`${id}\` is now stated but is still frozen in the baseline. Remove it — the baseline may ` +
        `only shrink, and a stale entry re-permits the debt it recorded.`,
    );
  }

  if (findings.length) {
    console.error('\nrule-statement-floor scan FAILED:');
    for (const f of findings) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    'rule-statement-floor scan passed. It checks that a statement EXISTS, not that it is correct or ' +
      'current — a rule whose text drifted from its mechanism passes here.',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) main();
