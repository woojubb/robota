#!/usr/bin/env node

/**
 * HARNESS-118 (issue #2248) — a citation of a task-record path is re-derived, not trusted.
 *
 * ## Why this is not a ratchet
 *
 * Measured before it was written: 1,779 citations across 401 tracked files, of which the LIVE
 * surface — rules, skills, specs, memory, active/draft spec-docs, live task records, scripts —
 * carries 22, and 20 after excluding two format examples. A flat gate is affordable here precisely
 * because history is out of scope: `.agents/spec-docs/done/` alone holds 607 stale citations, and a
 * completed document recording where a record was AT THE TIME is a record, not a defect. Rewriting
 * it would destroy the thing it is for.
 *
 * The corpus is therefore the finding-shaped risk in this scan, not the resolver. A corpus that
 * silently excluded the live surface would pass identically to one that works, which is why the
 * mutant that empties `LIVE_SOURCES` is part of the verification and not an afterthought.
 *
 * ## What it will not do
 *
 * It never repairs a `conflict`. See `task-path-citation.mjs` for why an ID-only resolver is worse
 * than no resolver: it turns a link a human would notice is broken into one nobody will question.
 *
 * Exit 0 = every live citation resolves to where it says, 1 = otherwise.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { enumerateFiles } from './enumerate-files.mjs';
import { classifyCitation, indexRecords, isHistorySource } from './task-path-citation.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Documents and code whose citations are LIVE CLAIMS a reader acts on. */
const LIVE_SOURCES = [
  '.agents/rules/',
  '.agents/skills/',
  '.agents/specs/',
  '.agents/spec-docs/',
  '.agents/memory/',
  '.agents/tasks/',
  'scripts/',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
];

/** A test's fixture is not a citation: it names a record that is supposed not to exist. */
const NOT_A_CITATION = [/\/__tests__\//, /\.test\.(ts|mjs|js)$/, /(^|\/)node_modules\//];

const CITATION = /\.agents\/tasks\/[A-Za-z0-9._/-]+\.md/g;

/**
 * Every outcome this scan can report, most serious first — and the list a test holds it to.
 *
 * Exported as DATA on purpose. A declared outcome that no code path produces is a claim about
 * behaviour nothing holds: `renamed` sat in this list, in the resolver's doc comment and in the task
 * record's TC-01 while the branch that should have produced it fell through to `moved`, and every
 * gate was green. Deriving the list from the source with a regex would not have caught it either —
 * a derivation narrows with the thing it derives from, so both sides shrink together and the
 * equation still holds. A literal list does not narrow itself.
 */
export const OUTCOME_ORDER = ['conflict', 'dangling', 'archived', 'moved', 'renamed'];

/**
 * Citations a PERSON must resolve, exempt from the gate and REPORTED on every pass.
 *
 * An exemption that prints nothing is a suppression: the finding stops being visible at exactly the
 * moment it stops being urgent. Each entry carries the reason it cannot be mechanical, and the pass
 * line names how many are outstanding.
 *
 * Two shapes are here. The first is a SENTENCE that contradicts the repair.
 *
 * Both of these read "미생성" — not yet created — beside a path that now resolves to a COMPLETED,
 * archived record. Repointing them yields a well-formed, resolvable, confident falsehood: a reader
 * following the link finds finished work under a sentence telling them it does not exist. That is
 * strictly worse than the stale path, and it is the failure `--fix` cannot see, because the tool
 * reads the path and a reader reads the claim around it.
 *
 * They are exempt from the SCAN, not resolved: each needs someone to decide whether the work
 * happened, and then correct the sentence or the record. Filed as part of issue #2248.
 */
// Assembled rather than written literally: this file is itself in the scanned corpus, and a literal
// path here would be read as a citation of its own. Excluding the scan's source instead would carve
// a hole in the corpus, which is the one thing this scan must not do quietly.
const TASKS_DIR = ['.agents', 'tasks'].join('/') + '/';
const SENTENCE_CONTRADICTS_REPAIR = [
  {
    file: '.agents/spec-docs/draft/HARNESS-017-dispatch-determinism-and-firing-measurement.md',
    cited: `${TASKS_DIR}INFRA-018.md`,
    outcome: 'archived',
    why: 'the sentence reads 미생성 — not yet created — beside a completed, archived record',
  },
  {
    file: '.agents/spec-docs/rejected/RESUME-001-session-resume-context-verification.md',
    cited: `${TASKS_DIR}RESUME-001.md`,
    outcome: 'archived',
    why: 'the sentence reads 미생성 — not yet created — beside a completed, archived record',
  },
  // The second shape is a CONFLICT: the ID and the slug lead to different records, so no repair can
  // be derived. These are the cases this scan exists to surface, and surfacing them is all it does.
  {
    file: 'scripts/harness/scan-release-verification-gate.mjs',
    cited: `${TASKS_DIR}DIST-002-release-artifact-verification.md`,
    outcome: 'conflict',
    why: 'slug belongs to DIST-005, the ID to an unrelated Bun-binary spec-doc; which is intended is a decision, not a lookup',
  },
  {
    file: 'scripts/harness/verify-macos-release-artifacts.sh',
    cited: `${TASKS_DIR}DIST-002-release-artifact-verification.md`,
    outcome: 'conflict',
    why: 'same conflict as the gate script, and the surrounding prose says DIST-002 too — renumbering one without the other would be worse',
  },
  {
    file: '.agents/memory/agent-run-capability-verification.md',
    cited: `${TASKS_DIR}SELFHOST-008-P6-surface-wiring-and-agent-run-verification.md`,
    outcome: 'conflict',
    why: 'the document calls a completed item an open fix; that is a status claim, filed as issue #2262',
  },
];

/**
 * The exemption for this citation, if its outcome is still the one the exemption excuses.
 *
 * An exemption PINS an outcome. Excusing a path instead would make the scan blind to the very
 * distinction it exists for: measured here, a mutant collapsing `conflict` into `moved` left the
 * whole tree green, because every conflict in the tree is exempt and a path-keyed exemption skipped
 * them before their classification mattered. Pinning the outcome turns that mutant red — a
 * reclassified citation is no longer the finding anyone signed off.
 */
function exemptionFor(file, cited, outcome) {
  return SENTENCE_CONTRADICTS_REPAIR.find(
    (one) => one.file === file && one.cited === cited && one.outcome === outcome,
  );
}

/**
 * A fenced block demonstrating the naming FORMAT is not a citation.
 *
 * The tasks README already gets this right: it demonstrates the shape with an id nothing can
 * resolve — `CHILD-001-description.md` — allow-missing-artifact: an example that must not resolve. An example that uses a LIVE id is indistinguishable from a citation to this scan and
 * to a reader both, which is the rule the `operational.md` case established.
 */
function citationLines(text) {
  const lines = text.split('\n');
  const out = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(CITATION)) out.push({ line: index + 1, cited: match[0] });
  }
  return out;
}

let examinedDocuments = 0;

/**
 * How many documents the last run actually OPENED.
 *
 * Incremented where the read happens, not taken from `sources.length`. The two agree until a read
 * throws and the file is skipped — the one moment the number is load-bearing, and the moment a
 * collection size would still report full coverage. Reset at the start of each run so a second run
 * in one process reports its own size rather than the sum.
 */
export function examinedDocumentCount() {
  return examinedDocuments;
}

/** Every citation in one document, with the line it sits on. Exported for the counter's test. */
export function collectCitations(text) {
  return citationLines(text);
}

export function liveSources(files) {
  return files.filter(
    (file) =>
      LIVE_SOURCES.some((prefix) => file.startsWith(prefix)) &&
      !isHistorySource(file) &&
      !NOT_A_CITATION.some((pattern) => pattern.test(file)),
  );
}

/**
 * Walk the live documents and classify every citation each one carries.
 *
 * Separated from `main` so the counter can be asserted against a fixture of KNOWN size. A counter
 * only reachable through a whole-tree run can be asserted against a bound, and every over-count —
 * including one that counts a document twice — satisfies a bound.
 */
export function findStaleCitations(sources, index, exists, readDocument) {
  examinedDocuments = 0;
  const findings = [];
  const matchedExemptions = new Set();
  for (const file of sources) {
    let text;
    try {
      text = readDocument(file);
    } catch {
      // A document that cannot be read was NOT examined, and the count must say so.
      continue;
    }
    examinedDocuments += 1;
    for (const { line, cited } of citationLines(text)) {
      const verdict = classifyCitation(cited, index, exists);
      if (verdict.outcome === 'exact') continue;
      const exemption = exemptionFor(file, cited, verdict.outcome);
      if (exemption) {
        matchedExemptions.add(exemption);
        continue;
      }
      findings.push({ file, line, cited, ...verdict });
    }
  }
  return { findings, matchedExemptions };
}

function main() {
  const files = enumerateFiles(['*']).filter((file) => existsSync(path.join(WORKSPACE_ROOT, file)));
  const index = indexRecords(files);
  const present = new Set(files);
  const exists = (file) => present.has(file);

  const { findings, matchedExemptions } = findStaleCitations(
    liveSources(files),
    index,
    exists,
    (file) => readFileSync(path.join(WORKSPACE_ROOT, file), 'utf-8'),
  );

  if (process.argv.includes('--fix')) {
    // REPAIRABLE means the ID and the slug agree on one record. `conflict` is excluded by
    // construction, not by a filter that could be relaxed later: repairing a citation whose two
    // axes disagree picks a document the citation never named, and does it with the authority of a
    // tool. That is the defect this scan exists to prevent, so --fix must not be able to cause it.
    const repairable = findings.filter(
      (one) => (one.outcome === 'moved' || one.outcome === 'archived') && one.actual,
    );
    const byFile = new Map();
    for (const one of repairable) {
      if (!byFile.has(one.file)) byFile.set(one.file, []);
      byFile.get(one.file).push(one);
    }
    for (const [file, group] of byFile) {
      const full = path.join(WORKSPACE_ROOT, file);
      let text = readFileSync(full, 'utf-8');
      // Substitute the cited path where it stands. Rebuilding the line would take whatever else
      // shares it — a lesson this repository has paid for more than once.
      for (const one of group) text = text.split(one.cited).join(one.actual);
      writeFileSync(full, text, 'utf-8');
      console.log(`fixed ${group.length} citation(s) in ${file}`);
    }
    const refused = findings.length - repairable.length;
    if (refused > 0) {
      console.log(
        `refused to repair ${refused} citation(s): a conflict or an unresolvable path needs a ` +
          'person, and guessing is how one of them got this way.',
      );
    }
    return;
  }

  console.log(
    `::examined:: ${examinedDocuments} live document(s) read, ${index.byId.size} work-item id(s)`,
  );

  // An exemption that stops matching is not a success. Measured: a mutant that made the resolver
  // answer `exact` for everything produced zero findings and left the scan green — every exemption
  // silently unmatched. Asserting them makes the corpus and the resolver both falsifiable, because
  // a scan that has stopped seeing its own known findings has stopped working.
  const unmatched = SENTENCE_CONTRADICTS_REPAIR.filter((one) => !matchedExemptions.has(one));
  if (unmatched.length > 0) {
    console.error(
      `\n- [stale exemption] ${unmatched.length} exemption(s) no longer match a finding. Either ` +
        'the citation was fixed — drop the row in the SAME change — or the scan stopped seeing it:',
    );
    for (const one of unmatched)
      console.error(`    ${one.file}\n      ${one.cited} [${one.outcome}]`);
    process.exitCode = 1;
    return;
  }

  if (findings.length === 0) {
    console.log(
      'task-path-citations scan passed. It re-derives each cited task-record path from the tree ' +
        'by ID AND slug; history is excluded as a citation source and included as a resolution ' +
        'target, because a completed record still exists.',
    );
    console.log(
      `${SENTENCE_CONTRADICTS_REPAIR.length} citation(s) are exempt and still OUTSTANDING — each ` +
        'needs a person, and none is repairable by this tool:',
    );
    for (const one of SENTENCE_CONTRADICTS_REPAIR) {
      console.log(`  ${one.file}\n    ${one.cited} — ${one.why}`);
    }
    return;
  }

  const order = OUTCOME_ORDER;
  for (const outcome of order) {
    const group = findings.filter((one) => one.outcome === outcome);
    if (group.length === 0) continue;
    console.error(`\n- [${outcome}] ${group.length} citation(s):`);
    for (const one of group) {
      console.error(`    ${one.file}:${one.line}`);
      console.error(`      cites  ${one.cited}`);
      if (one.outcome === 'conflict') {
        console.error(`      the ID resolves to   ${one.id?.join(', ') || '— nothing —'}`);
        console.error(`      the slug resolves to ${one.slug?.join(', ') || '— nothing —'}`);
        console.error(
          '      NOT repairable automatically: the two axes disagree, so any repair picks a ' +
            'document the citation did not name.',
        );
      } else {
        console.error(`      actual ${one.actual}`);
      }
    }
  }
  console.error(
    `\ntask-path-citations: ${findings.length} live citation(s) do not resolve to where they say.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
