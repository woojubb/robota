#!/usr/bin/env node

/**
 * HARNESS-050 — mechanical floor under the done gate: a completion record must not claim evidence
 * that was never produced.
 *
 * Measured 2026-07-26 on `INFRA-055` while its own implementation was still in flight. The document
 * carried `status: done`, `completed: 2026-07-26`, both Acceptance boxes ticked, a
 * `### Proof: a deliberately-broken promotion is BLOCKED` section whose ENTIRE body was
 * "See _Proof_ below (filled in from the live runs)" — a forward reference to a section that did not
 * exist — and "the second pass came back **ENDORSE**" written before the reviewer ruled (it returned
 * REVISE). No scan noticed. It was caught because an independent reviewer happened to check.
 *
 * WHY THE EXISTING GUARDS MISS IT. `check-done-evidence.mjs` (HARNESS-002) re-validates that cited
 * paths STILL RESOLVE — evidence decay, a real artifact that later vanished. It cannot see evidence
 * that was NEVER THERE. `scan-capability-reachability.mjs` (HARNESS-030) fences the declared-then-
 * dodge shape for capabilities only, opt-in via frontmatter. This scan closes the general case.
 *
 * DESIGN PRINCIPLE — fail closed on CITATION, not open on PHRASING. The first draft of U1 was a
 * placeholder-phrase blacklist ("TBD", "to be added", …). `proposal-reviewer` measured it: it fired
 * on 1 legitimate document and MISSED 23 real instances, because in every real case the placeholder
 * sits inside a longer section rather than alone, and 12 of them are written in Korean. A phrase
 * list cannot see half this repo's prose. So the primary test is inverted to the fail-closed form:
 * an evidence region must CITE something. You cannot dodge that by rephrasing — you have to produce
 * a citation. Same move `scan-main-required-checks.mjs` R3 made when its blacklist was proven green
 * on the very defect it existed to prevent.
 *
 * Rules (each measured at ZERO false positives over `.agents/tasks/completed/`, see the tests):
 *   U1  A labelled evidence field (`Evidence:` / `Proof:` / `Verification:` / `검증:` …) in a
 *       `status: done` item whose entire value is empty or a deferral placeholder.
 *   U2  A heading naming proof/evidence/verification whose body cites NOTHING — no repo path, no
 *       `#1234`, no URL, no sha, no filename, no fenced output.
 *   U3  A named section reference that does not resolve to a heading ("see _X_ below" where no
 *       heading `X` follows; "recorded under _X_" where no heading `X` exists at all).
 *   U4  A ticked `- [x]` acceptance box asserting "proven by …" with no citation after the claim.
 *
 * SCOPE (honest): this is a CITATION floor, not a truth oracle. A fabricated prose claim that cites
 * a real file still passes — no scanner can rule on that, and pretending otherwise would be the
 * vacuous-green shape this item exists to fence. What it makes impossible is the specific,
 * repeatedly-observed shape of a completion record written BEFORE the work, which cites nothing
 * because there is nothing yet to cite.
 *
 * TELL 5 (a claimed LIVE-CONFIGURATION change — "I set X to true" when the live setting says
 * otherwise) is DELIBERATELY NOT IMPLEMENTED here. See the HARNESS-050 backlog item for the full
 * reasoning; in short, this scan runs inside `harness:scan` → `harness:verify:release` → the
 * `release-grade verification` REQUIRED check on `protect-main`, so a network call here converts any
 * GitHub incident into a blocked promotion (the #1436 never-reports shape), and re-running a command
 * embedded in a markdown comment is arbitrary code execution from document content. The correct
 * vehicle is the off-merge-path reconciler family that `.github/workflows/ruleset-drift.yml` already
 * establishes.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { PATH_PATTERN } from './check-done-evidence.mjs';
import { asScalar, frontmatterObject } from './frontmatter.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Both halves of the backlog are scanned. `completed/` is where done items live; the root half is
 * normally unreachable because `check-backlog-placement.mjs` already fails a terminal-status root
 * file — but the incident document sat in the ROOT with `status: done` while it was defective, so
 * scanning it costs nothing and is the earliest possible detection point.
 */
const BACKLOG_DIRS = ['.agents/tasks', '.agents/tasks/completed'];

/**
 * Historical debt, enumerated rather than hidden — opened at 58 items / 71 findings, audited one by
 * one and every one genuine; **51 items remain** after the 2026-07-26 backlog reconciliation
 * back-filled 7 (`ARCH-FIX-004/007/013/015/017/018`, `WEB-014`) from evidence re-derived against the
 * live tree. Two more were ATTEMPTED and deliberately left: `ARCH-FIX-012`'s own Test Plan grep
 * returns 2, not the 0 it claims (`packages/agent-core/docs/SPEC.md:362`,
 * `packages/agent-framework/README.md:430`), and `ARCH-FIX-014`'s returns 15, not 0 — those are
 * unearned done claims that a citation would paper over, so they stay listed. 62 are an evidence field left as a literal promise ("(to be filled after
 * implementation)", "(구현 후 기록)") and 9 are an evidence section whose body says it will be
 * recorded later — inside items already marked `status: done`. They predate this floor and are NOT
 * this scan's false positives; they are the backlog of unearned done claims the floor exists to stop
 * growing. `.agents/tasks/completed/**` was outside the authorised paths of the change that
 * introduced this scan, so they could not be back-filled in the same commit.
 *
 * This list is ANTI-ROT, not an allowlist: an entry that stops producing a finding is itself a hard
 * failure, so the set can only shrink. Do not add entries — a NEW item that needs one is exactly
 * what the scan is for. Same forcing shape as `check-backlog-placement.mjs`'s LEGACY set, which was
 * driven to empty.
 */
const LEGACY_EVIDENCE_DEBT = new Set([
  '.agents/tasks/completed/ARCH-002-p6-provider-infra-to-framework.md',
  '.agents/tasks/completed/ARCH-002-p7-slim-agent-cli-public-api.md',
  '.agents/tasks/completed/ARCH-002-p8-extract-command-module-factory.md',
  '.agents/tasks/completed/ARCH-FIX-001-transport-sdk-reverse-dependency.md',
  '.agents/tasks/completed/ARCH-FIX-002-agent-event-service-compat-shim-removal.md',
  '.agents/tasks/completed/ARCH-FIX-005-terminal-output-type-ssot.md',
  '.agents/tasks/completed/ARCH-FIX-010-bundle-plugin-loader-product-name-fallback.md',
  '.agents/tasks/completed/ARCH-FIX-011-streaming-callback-fallback.md',
  '.agents/tasks/completed/ARCH-FIX-012-sub-agent-naming-violation.md',
  '.agents/tasks/completed/ARCH-FIX-014-spec-product-name-claude-code.md',
  '.agents/tasks/completed/ARCH-FIX-024-move-child-process-runner-to-agent-cli.md',
  '.agents/tasks/completed/ARCH-FIX-025-wire-auth-credits-or-document-debt.md',
  '.agents/tasks/completed/ARCH-FIX-026-fix-terminal-output-import-chain.md',
  '.agents/tasks/completed/ARCH-FIX-027-fix-transport-http-mcp-interface-source.md',
  '.agents/tasks/completed/ARCH-FIX-028-agent-runtime-io-boundary-croner-docs.md',
  '.agents/tasks/completed/ARCH-FIX-029-document-playground-execution-path.md',
  '.agents/tasks/completed/ARCH-FIX-030-read-package-version-to-framework.md',
  '.agents/tasks/completed/ARCH-FIX-031-reset-user-config-to-framework.md',
  '.agents/tasks/completed/ARCH-FIX-033-user-local-direct-command-double-report.md',
  '.agents/tasks/completed/CLI-003-web-flag-auto-open-browser.md',
  '.agents/tasks/completed/CLI-004-web-monitor-user-message-missing.md',
  '.agents/tasks/completed/CLI2-006-output-format-no-validation.md',
  '.agents/tasks/completed/CLI2-008-agent-command-mode-orphan-package.md',
  '.agents/tasks/completed/CLI2-009-resolve-git-branch-sync-ui-blocking.md',
  '.agents/tasks/completed/DEP-001-unused-dependencies-agent-server.md',
  '.agents/tasks/completed/DEP-002-google-api-key-env-name-mismatch.md',
  '.agents/tasks/completed/DEV-001-as-unknown-as-isideeffects-dead-code.md',
  '.agents/tasks/completed/DEV-002-non-null-assertion-websocket-sessionid.md',
  '.agents/tasks/completed/DEV-003-require-main-esm-misuse.md',
  '.agents/tasks/completed/DEV-004-websocket-error-type-always-auth.md',
  '.agents/tasks/completed/DEV-005-parseint-missing-radix.md',
  '.agents/tasks/completed/DEV-006-tool-concurrent-duplicate-matching-bug.md',
  '.agents/tasks/completed/DEV-008-server-shutdown-order-wrong.md',
  '.agents/tasks/completed/DEV-009-useinteractivesession-react-init-anti-pattern.md',
  '.agents/tasks/completed/DOCS-013-update-command-inventory-settings-user-local.md',
  '.agents/tasks/completed/DQ-AUDIT-004-responsibility-relocation.md',
  '.agents/tasks/completed/MKT-001-community-and-blog-content.md',
  '.agents/tasks/completed/MKT-002-v1-launch-seo.md',
  '.agents/tasks/completed/PLG-002-playground-agent-sdk-refactor.md',
  '.agents/tasks/completed/PLG-004-web-monitor-architecture-ws-http-separation.md',
  '.agents/tasks/completed/PROD-001-public-playground.md',
  '.agents/tasks/completed/SDK-001-interactive-session-interface-refactor.md',
  '.agents/tasks/completed/SDK-002-command-host-context-capability-interfaces.md',
  '.agents/tasks/completed/SDK-003-wire-plugin-packages-or-document.md',
  '.agents/tasks/completed/SDK-004-replace-bare-object-command-result.md',
  '.agents/tasks/completed/SDK-005-remove-chalk-from-agent-sdk.md',
  '.agents/tasks/completed/SDK-006-separate-agent-sdk-internal-exports.md',
  '.agents/tasks/completed/WEB-001-landing-positioning-quick-wins.md',
  '.agents/tasks/completed/WEB-002-onboarding-decision-tree.md',
  '.agents/tasks/completed/WEB-003-brand-design-system.md',
  '.agents/tasks/completed/WEB-004-playground-interactive-ux.md',
]);

// ---------------------------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------------------------

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

/**
 * What counts as a CITATION. Deliberately generous — the bar is "points at something outside this
 * sentence", not "proves the claim". A narrow token set would turn legitimate evidence prose red,
 * and a gate that fires on ordinary prose is suppressed within a day and then guards nothing.
 *
 * NOT included: a bare backticked span. `proven by \`the tests\`` cites nothing, and admitting it
 * was the specific weakness `proposal-reviewer` flagged in this rule's first draft.
 */
const CITATION_PATTERNS = [
  PATH_PATTERN, // packages/|apps/|scripts/ repo path — the ONE definition, from check-done-evidence
  /(?:^|[\s([])#\d+\b/, // PR / issue reference
  /https?:\/\/\S+/, // URL
  /\b[0-9a-f]{7,40}\b/, // commit sha
  /\b[\w.-]+\.(?:md|mjs|mts|cjs|ts|tsx|js|jsx|json|ya?ml|sh|toml|txt|png|log)\b/, // bare filename
  // A backticked span that points OUTSIDE the sentence: an executed command, a path, or a file with
  // an extension. `pnpm --filter x test — 403 tests pass` is this repo's most common evidence form,
  // and the first draft rejected it. A bare identifier span (`the tests`, `OptIn`) still does NOT
  // qualify — admitting those was the weakness `proposal-reviewer` flagged.
  /`\s*(?:pnpm|npm|npx|yarn|node|git|gh|bash|sh|zsh|make|docker|curl|python3?|cargo|tsc|vitest|jest|eslint|prettier|osv-scanner)\b[^`]*`/,
  /`[^`\n]*\//, // backticked path-like span
  /`[^`\n]*\b[\w-]+\.[A-Za-z][\w]{1,5}\b[^`\n]*`/, // backticked file-with-extension
  /\b[A-Z][A-Z0-9]{1,11}-\d{2,4}\b/, // a work-item id (CLI-053, INFRA-055) — this repo's cross-reference
];

/** A fenced block is pasted output — a citation of a run, which is what most proof sections show. */
function hasFence(lines) {
  return lines.some((line) => /^\s*(?:```|~~~)/.test(line));
}

function hasCitation(lines) {
  if (hasFence(lines)) return true;
  return lines.some((line) =>
    CITATION_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0; // PATH_PATTERN is /g — a stale lastIndex silently skips matches
      return pattern.test(line);
    }),
  );
}

/**
 * A deferral placeholder — a value that promises evidence instead of giving it. Bilingual: 12 of the
 * real instances in this repo are Korean, and an English-only list is a blacklist-of-one-spelling at
 * the language level. Used ONLY as U1's supplementary signal; the primary test everywhere else is
 * "does it cite anything", which no rephrasing evades.
 */
const PLACEHOLDER_VALUE_PATTERN =
  /^(?:[-–—*_(\s"']*)(?:(?:to\s+be|will\s+be)\s+(?:filled|added|written|completed|recorded|determined|provided|supplied)|filled\s+in\s+(?:from|after|later|by)|tbd|todo|pending|coming\s+soon|placeholder|see\s+below|추후|완료\s*후|구현\s*후|작성\s*예정|기록\s*예정|채울\s*예정)/iu;

// ---------------------------------------------------------------------------------------------
// U1 — a labelled evidence field whose entire value is empty or a deferral placeholder
// ---------------------------------------------------------------------------------------------

/** `Evidence:` / `- **Proof**:` / `검증:` … — a labelled field, not a heading. */
const EVIDENCE_FIELD_PATTERN =
  /^\s*(?:[-*+]\s+)?[_*]{0,2}(Evidence|Proof|Results?|Verification|Verified|검증|증거|근거)[_*]{0,2}\s*[:：]\s*(.*)$/i;

/**
 * The value of a labelled field: the remainder of its own line plus its continuation — wrapped lines
 * and any MORE-INDENTED list items, which is how this repo actually writes a multi-line evidence
 * value ("- Evidence:" followed by an indented bullet list). Reading only the field's own line
 * measured as a false positive on every such document. Stops at a blank line, a heading, the next
 * field, or a list item at the same-or-shallower indent.
 */
function readFieldValue(lines, index) {
  const match = EVIDENCE_FIELD_PATTERN.exec(lines[index]);
  const parts = [match[2]];
  const baseIndent = /^\s*/.exec(lines[index])[0].length;
  // `**Evidence**:` alone on its line, with the value in the block below (often after a blank line),
  // is a normal shape here. Treating the blank line as the end read those as empty and fired
  // falsely, so a label-only field adopts the following block — including top-level list items.
  const labelOnly = match[2].trim() === '';
  let started = !labelOnly;
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      if (started) break;
      continue; // label-only: skip the blank line before the value block
    }
    if (HEADING_PATTERN.test(line)) break;
    if (EVIDENCE_FIELD_PATTERN.test(line)) break;
    const indent = /^\s*/.exec(line)[0].length;
    const isListItem = /^\s*(?:[-*+]\s|\d+\.\s)/.test(line);
    if (isListItem && indent <= baseIndent && started) break;
    started = true;
    parts.push(line);
  }
  return parts;
}

function findU1(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (!EVIDENCE_FIELD_PATTERN.test(lines[i])) continue;
    const value = readFieldValue(lines, i);
    const joined = value.join(' ').trim();
    if (joined !== '' && !PLACEHOLDER_VALUE_PATTERN.test(joined)) continue;
    if (joined !== '' && hasCitation(value)) continue; // "TBD — see packages/x/y.ts" still cites
    findings.push({
      rule: 'U1',
      line: i + 1,
      message:
        joined === ''
          ? `evidence field '${lines[i].trim()}' has an empty value in a status: done item`
          : `evidence field '${lines[i].trim()}' still holds a deferral placeholder in a status: done item`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// U2 — an evidence/proof heading whose body cites nothing
// ---------------------------------------------------------------------------------------------

const EVIDENCE_HEADING_PATTERN = /\b(proof|evidence|verification|verified|검증|증거)\b/i;

/**
 * A PLAN is not evidence. `## Verification Plan` legitimately describes what WILL be checked, and
 * requiring it to cite a result is a category error — measured as a false positive on
 * `cli-provider-profile-naming-research.md`.
 */
const PLANNED_HEADING_PATTERN = /\b(plan|planned|strategy|approach|checklist|계획)\b/i;

/**
 * Which lines are the DOCUMENT's own text, as opposed to pasted output inside a fence.
 *
 * A `#` at the start of a line inside a ```` ```bash ```` block is a shell COMMENT, not a markdown
 * heading. `sectionsOf` and the U3 heading collector both read every line, so a comment like
 * `# 1. genuine bytes — the verification CI performs` became an evidence heading whose body cites
 * nothing — a finding on a completion record whose actual evidence is the fenced command right
 * under it. Measured on `INFRA-061`, where the "uncited evidence section" was a line of bash.
 *
 * U3 already skipped fences for its BODY reading and its own comment says so; the same file
 * collected headings out of those fences one loop earlier. One helper, so the two halves cannot
 * disagree again.
 */
export function outsideFences(lines) {
  const outside = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      outside.push(false);
      continue;
    }
    outside.push(!inFence);
  }
  return outside;
}

/** Sections of the document: heading, its level, and the body down to the next same-or-higher heading. */
export function sectionsOf(lines) {
  const outside = outsideFences(lines);
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    if (!outside[i]) continue;
    const match = HEADING_PATTERN.exec(lines[i]);
    if (!match) continue;
    const level = match[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (!outside[j]) continue;
      const inner = HEADING_PATTERN.exec(lines[j]);
      if (inner && inner[1].length <= level) {
        end = j;
        break;
      }
    }
    sections.push({ heading: match[2], level, line: i + 1, body: lines.slice(i + 1, end) });
  }
  return sections;
}

function findU2(lines) {
  const findings = [];
  for (const section of sectionsOf(lines)) {
    if (!EVIDENCE_HEADING_PATTERN.test(section.heading)) continue;
    if (PLANNED_HEADING_PATTERN.test(section.heading)) continue;
    // A section that only introduces sub-sections is not itself the evidence — judge the leaves.
    if (section.body.some((line) => HEADING_PATTERN.test(line))) continue;
    if (hasCitation(section.body)) continue;
    if (section.body.every((line) => line.trim() === '')) {
      findings.push({
        rule: 'U2',
        line: section.line,
        message: `evidence section '${section.heading.trim()}' is empty in a status: done item`,
      });
      continue;
    }
    findings.push({
      rule: 'U2',
      line: section.line,
      message: `evidence section '${section.heading.trim()}' cites nothing — no path, PR ref, URL, sha, filename or pasted output`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// U3 — a named section reference that does not resolve to a heading
// ---------------------------------------------------------------------------------------------

/**
 * Case folding is scoped to the VERB alternation on purpose. Making the whole expression /i silently
 * voids the Title-case constraint on the name (`[A-Z]` matches lowercase under /i), which
 * `proposal-reviewer` measured taking the false-positive count from 0 to 11 — it starts matching
 * ordinary prose like "a documented catalog of…". This is exactly the kind of invisible-fragile
 * lever that must be written down next to the code.
 *
 * Every verb but `see` must appear as PARTICIPLE + PREPOSITION ("recorded in", "summarised under").
 * The bare stems are ordinary English nouns in this corpus — measured false positives on "the list
 * returns focus", "a task detail returns to", and `checkSettingsDocument` — so only the form that is
 * unambiguously a cross-reference counts.
 */
const REF_VERB =
  '\\b(?:[Ss]ee|(?:[Ss]ummaris|[Ss]ummariz|[Rr]ecord|[Dd]escrib|[Dd]etail|[Dd]ocument|[Ll]ist)ed\\s+(?:in|under|at))';
const TITLE_NAME = '[A-Z][A-Za-z]*(?:[ -][A-Z][A-Za-z]*){0,3}';

/**
 * "below" half — markup on the name is NOT required. A plain `see Proof below` is just as much an
 * unresolved forward reference as `see _Proof_ below`, and requiring markup would leave that
 * one-character evasion open. Measured at 0 false positives over the corpus, so the narrowing buys
 * nothing.
 */
const REF_BELOW_PATTERN = new RegExp(
  `${REF_VERB}\\b[^.\\n]{0,40}?[_*"]{0,2}(${TITLE_NAME})[_*"]{0,2}[^.\\n]{0,20}?\\bbelow\\b`,
  'g',
);

/**
 * Anchored half (no "below") — markup IS required. Without it the pattern collides with ordinary
 * capitalised prose. Backticks are excluded from the markup set: they collide with code identifiers
 * ("Listed as standalone `OptIn` layer", "Documented `AbstractNodeDefinition` in"), which
 * `proposal-reviewer` measured as 6 false positives.
 */
const REF_ANCHORED_PATTERN = new RegExp(
  `${REF_VERB}\\b[^.\\n]{0,40}?(?:_(${TITLE_NAME})_|\\*\\*(${TITLE_NAME})\\*\\*)`,
  'g',
);

/**
 * MENTION IS NOT USE. Text that QUOTES a reference — "the incident's `see _Proof_ below`" — is
 * describing the pattern, not making the claim. Quoted spans and inline code are blanked (to spaces,
 * so match offsets are preserved) before U3 looks at a line, and fenced blocks are skipped whole.
 *
 * Found by running this scan against its OWN completion record, which quotes the incident's wording
 * twice and was reddened by it. A guard that cannot survive being documented would be edited around
 * rather than fixed, and the double-quote form is why `"Name"` is not in the markup set above.
 */
function maskQuotations(line) {
  return line
    .replace(/`[^`]*`/g, (span) => ' '.repeat(span.length))
    .replace(/"[^"\n]*"/g, (span) => ' '.repeat(span.length))
    .replace(/[“”][^“”\n]*[“”]/g, (span) => ' '.repeat(span.length));
}

/** A heading resolves a name if its text equals it, or starts with it followed by a non-word char. */
function headingResolves(headingText, name) {
  const clean = headingText.replace(/[`_*]/g, '').trim().toLowerCase();
  const target = name.trim().toLowerCase();
  if (clean === target) return true;
  return clean.startsWith(target) && /[^\w]/.test(clean.charAt(target.length));
}

function findU3(lines) {
  const findings = [];
  const outside = outsideFences(lines);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    // A `#` line inside a fence is a shell comment, not a heading a reference can resolve to. This
    // loop used to read every line while the body loop below skipped fences — the same file
    // disagreeing with itself about what a heading is.
    if (!outside[i]) continue;
    const match = HEADING_PATTERN.exec(lines[i]);
    if (match) headings.push({ text: match[2], line: i + 1 });
  }

  for (let i = 0; i < lines.length; i++) {
    if (!outside[i]) continue; // pasted output is quoted material, not the document's own claim
    if (HEADING_PATTERN.test(lines[i])) continue;
    const line = maskQuotations(lines[i]);

    const seen = new Set();
    const record = (name, mustFollow) => {
      if (name === undefined || seen.has(name)) return;
      seen.add(name);
      const resolved = headings.some(
        (heading) => headingResolves(heading.text, name) && (!mustFollow || heading.line > i + 1),
      );
      if (resolved) return;
      findings.push({
        rule: 'U3',
        line: i + 1,
        message: mustFollow
          ? `forward reference to a section '${name}' that does not follow — no heading '${name}' appears after this line`
          : `reference to a section '${name}' that does not exist — no heading '${name}' in this document`,
      });
    };

    REF_BELOW_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(REF_BELOW_PATTERN)) record(match[1], true);
    if (!/\bbelow\b/.test(line)) {
      REF_ANCHORED_PATTERN.lastIndex = 0;
      for (const match of line.matchAll(REF_ANCHORED_PATTERN)) {
        record(match[1] ?? match[2] ?? match[3], false);
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// U4 — a ticked acceptance box asserting proof with no citation after the claim
// ---------------------------------------------------------------------------------------------

const TICKED_BOX_PATTERN = /^\s*[-*+]\s+\[x\]\s/i;
const PROOF_CLAIM_PATTERN = /\b(?:proven|proved|verified|demonstrated|evidenced|confirmed)\s+by\b/i;

/** A checkbox item's own line plus its indented continuation lines. */
function readCheckboxItem(lines, index) {
  const parts = [lines[index]];
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break;
    if (HEADING_PATTERN.test(line)) break;
    if (/^\s*[-*+]\s/.test(line)) break;
    parts.push(line);
  }
  return parts;
}

function findU4(lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TICKED_BOX_PATTERN.test(lines[i])) continue;
    const item = readCheckboxItem(lines, i);
    const text = item.join('\n');
    const claim = PROOF_CLAIM_PATTERN.exec(text);
    if (!claim) continue;
    // Only what comes AFTER the assertion counts. A backticked identifier in the requirement's own
    // wording is not evidence for it — the pre-correction INFRA-055 box named `protect-main` before
    // its "proven by" and cited nothing after it.
    const after = text.slice(claim.index + claim[0].length);
    if (hasCitation(after.split('\n'))) continue;
    findings.push({
      rule: 'U4',
      line: i + 1,
      message: `ticked acceptance box asserts '${claim[0].trim()} …' but cites nothing after the claim`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------

/** Every rule over one document's text. Exported for direct fixture testing. */
export function evaluateDocument(content) {
  const lines = content.split('\n');
  return [...findU1(lines), ...findU2(lines), ...findU3(lines), ...findU4(lines)].sort(
    (a, b) => a.line - b.line || a.rule.localeCompare(b.rule),
  );
}

/** U1/U2 are the legacy-debt rules; U3/U4 have no legacy population and are never exempt. */
const LEGACY_RULES = new Set(['U1', 'U2']);

export function findUnearnedDoneClaimFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const legacyHits = new Set();

  for (const dir of BACKLOG_DIRS) {
    const absolute = path.join(root, dir);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute).sort()) {
      if (!entry.endsWith('.md') || entry === 'README.md') continue;
      const relative = path.posix.join(dir, entry);
      const content = readFileSync(path.join(absolute, entry), 'utf8');
      if (asScalar(frontmatterObject(content).status).toLowerCase() !== 'done') continue;
      const isLegacy = LEGACY_EVIDENCE_DEBT.has(relative);
      for (const finding of evaluateDocument(content)) {
        if (isLegacy && LEGACY_RULES.has(finding.rule)) {
          legacyHits.add(relative);
          continue;
        }
        findings.push({ file: relative, ...finding });
      }
    }
  }

  // Anti-rot: a legacy entry that no longer produces a finding must leave the set, or the set
  // becomes a permanent allowlist and the guard becomes decorative.
  const staleLegacy = [...LEGACY_EVIDENCE_DEBT].filter((file) => !legacyHits.has(file)).sort();

  return { findings, staleLegacy, legacyCount: legacyHits.size };
}

function main() {
  const { findings, staleLegacy, legacyCount } = findUnearnedDoneClaimFindings();

  if (findings.length === 0 && staleLegacy.length === 0) {
    console.log(
      `unearned-done-claims scan passed${legacyCount > 0 ? ` (${legacyCount} legacy evidence-debt item(s) exempt)` : ''}.`,
    );
    process.exit(0);
  }

  if (findings.length > 0) {
    console.error(
      'unearned-done-claims scan FAILED — a done item claims evidence it does not have:',
    );
    for (const finding of findings) {
      console.error(`  - ${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`);
    }
    console.error(
      '\nA completion record is believed, never re-verified — so it must cite what it claims.\n' +
        '  Fill the evidence in (a repo path, a PR ref, a URL, a commit sha or pasted output), or, if the\n' +
        '  work is not actually finished, take the item out of `status: done`.',
    );
  }

  if (staleLegacy.length > 0) {
    console.error(
      '\nunearned-done-claims scan FAILED — LEGACY_EVIDENCE_DEBT entries no longer produce a finding:',
    );
    for (const file of staleLegacy) console.error(`  - ${file}`);
    console.error(
      '\nThese were back-filled — remove them from LEGACY_EVIDENCE_DEBT in\n' +
        '  scripts/harness/scan-unearned-done-claims.mjs. The set may only shrink.',
    );
  }

  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
