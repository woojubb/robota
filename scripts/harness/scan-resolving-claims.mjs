#!/usr/bin/env node

/**
 * A claim must name something that exists.
 *
 * The most-repeated status defect in this repository is a document naming an artifact that is not
 * there: a `FILED` that filed nothing, a link left behind by a rename, a ticked box whose own text
 * says the work is unfinished. Nine or more occurrences, six reconciliation passes in seven days,
 * five items moved back out of `completed/` — and every one of them was mechanically detectable
 * without judgement, because a name either resolves or it does not.
 *
 * PURELY REFERENTIAL. It asks one question — does the thing you named exist? — and nothing about
 * whether the work behind it is genuinely done. That judgement is where noise comes from, and other
 * scans already attempt it.
 *
 * ## Scoped to the LIVE tree
 *
 * `completed/`, `done/`, `rejected/` and the archives are historical records. Their citations may
 * legitimately point at things since renamed, and failing on them would fire on correct data — the
 * shape that gets a guard suppressed. The exemption is stated here rather than left implicit, and it
 * is the reason this scan can be a flat gate rather than a ratchet: the live tree is at zero.
 *
 * Measured before it landed: 216 broken links across the whole of `.agents/`, and 24 in the live
 * tree. The 24 were repaired; the archive's are left as the record they are.
 *
 * ## What is deliberately NOT a broken link
 *
 *  - **A fenced block.** A specimen shows a shape; its paths are illustrations.
 *  - **A template slot** — a target containing `<…>` or `*`. `packages/<pkg>/docs/SPEC.md` names a
 *    form, not a file, and a template that resolved would be a template of one package.
 *  - **A path a document is ABOUT.** A file explaining link resolution must be able to show an
 *    unresolvable link without becoming one; the marker `<!-- allow-unresolved: <reason> -->` on the
 *    line says so, and the reason is required.
 *
 * Exit 0 = every claim in the live tree resolves.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const LIVE_ROOT = '.agents';

/** Historical records: their citations describe a tree that has moved on, and that is correct. */
const ARCHIVED = ['completed', 'done', 'rejected', 'archive', 'daily-reports'];

const ALLOW = /<!--\s*allow-unresolved:\s*([^]*?)-->/;

/**
 * A target naming a FORM rather than a file — `lib/file-name-shape.mjs` owns the question.
 *
 * This scan carried a private, NARROWER copy (`<>*` only) that had already drifted from its
 * sibling's; a link target written `ADR-NNN-short-title.md` was a finding here and a non-finding
 * there. One answer now. The wider set only EXCUSES more, and what it excuses is a form, which was
 * never this scan's subject.
 */
import { isTemplateSlot } from './lib/file-name-shape.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

export { isTemplateSlot };

export function hasAllowedReason(line) {
  const match = ALLOW.exec(line);
  return Boolean(match && match[1].trim().length > 0);
}

/**
 * Unresolvable relative links in one document.
 *
 * `resolves` is injected so a case can describe a tree without building one.
 */
export function findUnresolvedLinks(source, { resolves }) {
  const findings = [];
  let inFence = false;
  source.split('\n').forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    // Scoped to the SEGMENT the declaration follows, not the whole line: a line carrying two links
    // where only one is deliberately unresolvable would otherwise excuse the other, which is a real
    // broken link waved through by its neighbour's reason.
    const declaredFrom = line.search(ALLOW);

    for (const match of line.matchAll(/\[[^\]]*\]\((?!https?:|mailto:|#)([^)\s]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (target === '' || isTemplateSlot(target)) continue;
      if (resolves(target)) continue;
      if (declaredFrom !== -1 && match.index < declaredFrom && hasAllowedReason(line)) continue;
      findings.push({ line: index + 1, target, text: line.trim().slice(0, 120) });
    }
  });
  return findings;
}

/**
 * A work-item ID claimed as FILED, and whether the tree holds an item by that name.
 *
 * The instance that filed this: a document marked three findings `FILED` and nothing had been filed —
 * discovered weeks later, by someone going to look. An ID either resolves to a document or it does
 * not, and that is decidable without judging whether the work behind it is done.
 */
const FILED_CLAIM =
  /\b(?:FILED|filed as|tracked as|filed under|see)\s*:?\s*\[?`?([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,}(?:-P\d+)?)`?\]?/g;

/** A ticked box whose own text says the work is not finished. */
// Case-SENSITIVE for `TODO`, and never as part of a path. The case-insensitive form matched the
// directory name `todo/` inside a perfectly finished checklist item — a guard firing on a correct
// state, found on this scan's first run over the real tree.
const UNFINISHED_IN_TICKED_BOX = /\b(?:remaining|still open|not yet|is filed as|to be done)\b/i;
const TODO_MARKER = /\bTODO\b(?!\/)/;

export function findClaimFindings(source, { idExists }) {
  const findings = [];
  let inFence = false;
  source.split('\n').forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence || hasAllowedReason(line)) return;

    FILED_CLAIM.lastIndex = 0;
    let match;
    while ((match = FILED_CLAIM.exec(line)) !== null) {
      if (!idExists(match[1])) {
        findings.push({
          line: index + 1,
          kind: 'filed-nothing',
          target: match[1],
          text: line.trim().slice(0, 120),
        });
      }
    }

    if (
      /^\s*- \[[xX]\]/.test(line) &&
      (UNFINISHED_IN_TICKED_BOX.test(line) || TODO_MARKER.test(line))
    ) {
      findings.push({
        line: index + 1,
        kind: 'ticked-but-unfinished',
        target: '[x]',
        text: line.trim().slice(0, 120),
      });
    }
  });
  return findings;
}

/**
 * Every work-item ID the tree DEFINES — as a document, or as a section heading inside one.
 *
 * The heading half is not a nicety. An audit document numbers its own findings `### CLI-AUDIT-019:`
 * and cross-references them by that number; reading filenames alone reported one of those as naming
 * nothing, while it was defined forty lines above the reference. A definition is a definition
 * wherever the tree puts it, and a check that only knows one shape fires on correct data.
 */
export function knownItemIds(root = WORKSPACE_ROOT) {
  const ids = new Set();
  const HEADING_ID = /^#{1,6}\s+([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,}(?:-P\d+)?)\b/gm;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const id = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,}(?:-P\d+)?)/.exec(entry.name);
      if (id) ids.add(id[1]);
      if (entry.name.endsWith('.md')) {
        const text = readFileSync(full, 'utf8');
        HEADING_ID.lastIndex = 0;
        for (const heading of text.matchAll(HEADING_ID)) ids.add(heading[1]);
      }
    }
  };
  // An archived item still RESOLVES — a claim naming work that has since landed is correct.
  walk(path.join(root, '.agents/tasks'));
  walk(path.join(root, '.agents/spec-docs'));
  // Decisions are work items too, and they do NOT live under `.agents`. Omitting this directory made
  // the scan report a real ADR as naming nothing — a check that fires on correct data, which is the
  // shape that gets a guard suppressed. Found by running it.
  walk(path.join(root, '.design/decisions'));
  // Headings live wherever documents do, including the specs tree that carries the audit numbering.
  walk(path.join(root, '.agents/specs'));
  return ids;
}

function isArchived(relativeDir) {
  return relativeDir.split(path.sep).some((segment) => ARCHIVED.includes(segment));
}

function markdownFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ARCHIVED.includes(entry.name)) walk(full);
        continue;
      }
      if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(root);
  return out;
}

export function scanResolvingClaims(root = WORKSPACE_ROOT) {
  const live = path.join(root, LIVE_ROOT);
  // Fail closed: a sweep over a tree that is not there finds nothing, and nothing is not clean.
  if (!existsSync(live) || !statSync(live).isDirectory()) {
    throw new Error(`resolving-claims: ${LIVE_ROOT} does not exist under ${root}.`);
  }
  const files = markdownFiles(live);
  if (files.length === 0) {
    throw new Error(`resolving-claims: ${LIVE_ROOT} holds no documents to examine.`);
  }

  const ids = knownItemIds(root);
  const findings = [];
  for (const file of files) {
    const dir = path.dirname(file);
    if (isArchived(path.relative(root, dir))) continue;
    const source = readFileSync(file, 'utf8');
    const found = [
      ...findUnresolvedLinks(source, {
        // A target beginning `/` is REPOSITORY-root-relative, the ordinary markdown convention.
        // Handed to `path.resolve` beside the document it becomes an OS absolute path — `/AGENTS.md`
        // — and a correct link is reported as naming nothing. This scan's own argument for exempting
        // the archives is that a check must not fire on correct data.
        resolves: (target) =>
          existsSync(
            target.startsWith('/') ? path.join(root, target.slice(1)) : path.resolve(dir, target),
          ),
      }).map((f) => ({ kind: 'link-names-nothing', ...f })),
      ...findClaimFindings(source, { idExists: (id) => ids.has(id) }),
    ];
    for (const finding of found) findings.push({ file: path.relative(root, file), ...finding });
  }
  return { findings, examined: files.length };
}

function main() {
  const { findings, examined } = scanResolvingClaims();
  console.log(`::examined:: ${examined} live documents`);

  if (findings.length > 0) {
    console.error(`resolving-claims scan failed: ${findings.length} claim(s) name nothing:`);
    for (const finding of findings) {
      console.error(`  - [${finding.kind}] ${finding.file}:${finding.line} -> ${finding.target}`);
      console.error(`      ${finding.text}`);
    }
    console.error(
      '\nRepoint it, or — if the path is meant to be unresolvable, as in a document about link ' +
        'resolution — declare it with `<!-- allow-unresolved: <reason> -->` on the line.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `resolving-claims scan passed (${examined} live document(s) examined; every relative link ` +
      'resolves). Archived trees are exempt: their citations describe a tree that has moved on.',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
