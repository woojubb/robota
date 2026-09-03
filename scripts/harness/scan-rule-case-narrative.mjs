#!/usr/bin/env node

/**
 * A rule states an invariant. It does not tell the story of how the invariant was learned.
 *
 * Two costs, and the second is the one that matters. Every line of a rule is loaded before any work
 * begins, so narrative is paid for on every task forever. And a rule justified by an incident invites
 * the reader to decide whether their situation RESEMBLES that incident — which is precisely the
 * discretion a rule exists to remove.
 *
 * WHAT IT FLAGS: a citation in a rule document — a work-item identifier, a pull-request or issue
 * number, a calendar date. Those are the marks of a case, and they are what a machine can see.
 *
 * WHAT IT CANNOT SEE: narrative whose citation has worn off. A paragraph retelling an incident with
 * every proper noun removed reads as an invariant and passes here. This check bounds the citable
 * class only; the line-by-line pass is a separate obligation and this scan going green does not
 * discharge it. Saying so is part of the check — a floor that lets itself be mistaken for a ceiling
 * is worse than no floor.
 *
 * WHAT IS NOT A CASE:
 *
 *  - **A resolving link.** `[SOME-123](../tasks/SOME-123-….md)` is the relocation the form asks for:
 *    the invariant is here, the incident is in the record that owns it, and the reader can go there.
 *    The target must EXIST — a rule citing an identifier that resolves to nothing is the condition
 *    the rules themselves refuse — so this exemption doubles as the check for that.
 *  - **A specimen.** Inside a fenced code block, an identifier is a slot in a format being shown, not
 *    a claim about something that happened.
 *
 *    An INLINE code span is deliberately not exempt, though the same argument seems to apply to it.
 *    Measured over this tree: of the citations inside single backticks, some are specimens and at
 *    least one is a plain retelling of a particular case. So the exemption would not separate the two
 *    — and worse, it would make evasion a matter of typing two backticks around the citation. An
 *    inline example that must name a real identifier declares itself below, which costs one line and
 *    is read once by a reviewer.
 *  - **A declared exception**, carrying its reason: `<!-- allow-citation: … -->` on the line.
 *
 * A RATCHET, not a flat gate. The tree has a history and the count is not zero today; a check that is
 * red on arrival gets suppressed rather than obeyed. Per-file counts are frozen, may fall, and must
 * never rise — and a fall must be re-frozen in the SAME change, or the gain is a licence to grow back.
 *
 * Exit 0 = every file at its frozen count, 1 = otherwise.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const RULES_DIR = '.agents/rules';
const BASELINE_PATH = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/rule-case-narrative-baseline.json',
);

// A work item (`SOME-123`, `SOME-SUB-004`), a pull-request or issue number, an ISO date. Three
// shapes, one question: does this line point at a particular thing that happened?
const CITATION =
  /\b[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,}\b|#\d{3,5}\b|\b20\d{2}-\d{2}-\d{2}\b/g;
// The reason has to BE a reason. Anchored on the comment terminator rather than on "some non-space
// character", because `<!-- allow-citation: -->` satisfies the second — the `-` of `-->` reads as
// the start of an explanation — and an exception nobody had to justify is the one that spreads.
const ALLOW = /<!--\s*allow-citation:([^]*?)-->/;

function hasDeclaredReason(line) {
  const match = ALLOW.exec(line);
  return Boolean(match && match[1].trim().length > 0);
}

/** Markdown links on a line, as `[text](target)` pairs, so a citation can be tested for being one. */
function linkSpans(line) {
  const spans = [];
  const re = /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
  let match;
  while ((match = re.exec(line)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length, target: match[2] });
  }
  return spans;
}

/**
 * Citations in one document that are not exempt.
 *
 * `resolves` decides whether a link target is real; it is injected so a case can describe a tree
 * without building one, and so this function does no filesystem work of its own.
 */
export function findCaseNarrative(source, { resolves }) {
  const findings = [];
  let inFence = false;

  source.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence || hasDeclaredReason(line)) return;

    const links = linkSpans(line);
    // A link names each record ONCE, however many times that record's identifier appears inside it.
    // `[SOME-123](…/SOME-123-the-thing.md)` names the same record twice by construction — in the text
    // and in the path — and counting both would make a correctly-relocated case look twice as bad as
    // a bare one. Keyed on the identifier as well as the link, because one link can name two
    // different records: deduping on the link alone dropped the second, which is a citation the
    // ratchet then cannot see.
    const countedInLink = new Set();
    CITATION.lastIndex = 0;
    let match;
    while ((match = CITATION.exec(line)) !== null) {
      const at = match.index;
      const link = links.find((span) => at >= span.start && at < span.end);
      if (link && resolves(link.target)) continue;
      if (link) {
        const key = `${link.start}:${match[0]}`;
        if (countedInLink.has(key)) continue;
        countedInLink.add(key);
      }
      findings.push({
        line: index + 1,
        citation: match[0],
        // A citation inside a BROKEN link is the worse of the two defects, and saying which it is
        // stops the fix being "delete the link" when it should be "point it somewhere real".
        kind: link ? 'unresolved-link' : 'case-narrative',
        text: line.trim().slice(0, 120),
      });
    }
  });

  return findings;
}

function resolverFor(fileDir) {
  return (target) => {
    if (/^(https?:|mailto:)/.test(target)) return true;
    const withoutAnchor = target.split('#')[0];
    if (withoutAnchor === '') return true;
    return existsSync(path.resolve(fileDir, withoutAnchor));
  };
}

export function scanRules(root = WORKSPACE_ROOT) {
  const dir = path.join(root, RULES_DIR);
  if (!existsSync(dir)) {
    // Fail closed. A count taken over no documents is not a low count.
    throw new Error(`rule-case-narrative: ${RULES_DIR} does not exist under ${root}.`);
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort();
  if (files.length === 0) {
    throw new Error(`rule-case-narrative: ${RULES_DIR} holds no documents to examine.`);
  }

  const perFile = {};
  const findings = [];
  for (const name of files) {
    const full = path.join(dir, name);
    const found = findCaseNarrative(readFileSync(full, 'utf8'), {
      resolves: resolverFor(path.dirname(full)),
    });
    perFile[name] = found.length;
    for (const finding of found) findings.push({ file: name, ...finding });
  }
  return { perFile, findings, examined: files.length };
}

function loadBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : undefined;
}

/**
 * The verdict over every file at once.
 *
 * Both directions are reported before it returns, so one run tells an operator everything they must
 * act on. Stopping at the first offender turns a sweep into a queue of runs.
 */
export function compare(perFile, baseline) {
  const grew = [];
  const shrunk = [];
  const unfrozen = [];
  for (const [name, count] of Object.entries(perFile)) {
    const frozen = baseline[name];
    if (frozen === undefined) {
      if (count > 0) unfrozen.push({ name, count });
      continue;
    }
    if (count > frozen) grew.push({ name, count, frozen });
    if (count < frozen) shrunk.push({ name, count, frozen });
  }
  // A frozen file that has since been deleted or renamed is drift too: its row would otherwise sit
  // in the baseline forever, excusing a count nobody is measuring any more.
  const missing = Object.keys(baseline).filter((name) => perFile[name] === undefined);
  return {
    grew,
    shrunk,
    unfrozen,
    missing,
    ok: !grew.length && !shrunk.length && !unfrozen.length && !missing.length,
  };
}

function main() {
  const { perFile, findings, examined } = scanRules();
  const baseline = loadBaseline();
  const total = Object.values(perFile).reduce((sum, n) => sum + n, 0);

  const unresolved = findings.filter((f) => f.kind === 'unresolved-link');
  for (const finding of unresolved) {
    console.error(
      `- [unresolved-link] ${RULES_DIR}/${finding.file}:${finding.line}: ` +
        `\`${finding.citation}\` is linked to a target that does not exist — ${finding.text}`,
    );
  }

  if (baseline === undefined) {
    console.error('rule-case-narrative: no frozen baseline — run --write-baseline.');
    process.exitCode = 1;
    return;
  }

  const verdict = compare(perFile, baseline);
  for (const { name, count, frozen } of verdict.grew) {
    console.error(
      `- [grew] ${RULES_DIR}/${name}: ${count} citation(s), up from a frozen ${frozen}. ` +
        'Three ways out: state the invariant and leave the case in the record that owns it; link to ' +
        'that record so the citation resolves; or, when the identifier IS the instruction — a format ' +
        'specimen, a worked-example path — declare it with `<!-- allow-citation: <reason> -->`.',
    );
    for (const f of findings.filter((f) => f.file === name)) {
      console.error(`    ${name}:${f.line}  ${f.citation}  ${f.text}`);
    }
  }
  for (const { name, count, frozen } of verdict.shrunk) {
    console.error(
      `- [fell] ${RULES_DIR}/${name}: ${frozen} → ${count}. Re-freeze in the SAME change ` +
        '(--write-baseline), or the gain is a licence to grow back.',
    );
  }
  for (const { name, count } of verdict.unfrozen) {
    console.error(
      `- [unfrozen] ${RULES_DIR}/${name}: ${count} citation(s) in a document the baseline does not ` +
        'know. A new rule document starts at zero, or is frozen deliberately.',
    );
  }
  for (const name of verdict.missing) {
    console.error(
      `- [stale-baseline] ${RULES_DIR}/${name}: frozen, but no such document. Remove its row.`,
    );
  }

  if (!verdict.ok || unresolved.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} rule documents`);
  console.log(
    `rule-case-narrative scan passed (${examined} rule document(s) examined; ${total} citation(s) ` +
      'at baseline). It bounds the CITABLE class only — narrative whose citation has worn off is ' +
      'out of its reach, and the line-by-line pass is a separate obligation.',
  );
}

function writeBaseline() {
  const { perFile, examined } = scanRules();
  const frozen = Object.fromEntries(Object.entries(perFile).filter(([, count]) => count > 0));
  writeFileSync(BASELINE_PATH, `${JSON.stringify(frozen, null, 2)}\n`);
  const total = Object.values(frozen).reduce((sum, n) => sum + n, 0);
  console.log(
    `rule-case-narrative baseline frozen: ${total} citation(s) across ` +
      `${Object.keys(frozen).length} of ${examined} document(s)`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
