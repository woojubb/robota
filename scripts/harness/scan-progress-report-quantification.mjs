#!/usr/bin/env node

/**
 * Mechanical floor for the **Quantified progress reporting** conduct rule
 * (`.agents/rules/agent-conduct.md`, Communication & Formatting): a mid-work status update over a
 * countable work set must state the ratio **and** the percentage ("3/7 done = 43%"), never a bare
 * ratio or a vague "making progress" (HARNESS-026).
 *
 * ## The channel
 *
 * A progress report is emitted as free-form assistant narrative, not as a repo file — so for a long
 * time this rule was assumed unenforceable. It is not: the agent harness records every session as a
 * JSONL transcript, and hook payloads carry its path (`transcript_path`). Two in-repo hooks already
 * read that channel and parse assistant message text — `.claude/hooks/correction-detect.sh` (the
 * previous-assistant-message hash) and `.claude/hooks/revert-detect.sh`. This scan reads the same
 * channel post-hoc, so the narrative stream IS observable to the harness.
 *
 * ## Scope of the mechanical claim (deliberately narrow)
 *
 * Deciding whether an arbitrary sentence *is* "a mid-work update over a countable set" is a semantic
 * judgment no regex can make, so this scan does NOT attempt it. It enforces the half of the rule
 * that is mechanically decidable and that carries the rule's operative requirement — "report both
 * the count and the percentage":
 *
 *   a narrative line that already states a PARTIAL completion ratio (N/M with N < M) in a
 *   completion context, and omits the percentage, is a violation.
 *
 * A bare "making progress" with no numbers at all stays prose-governed (classifying it needs the
 * semantic judgment above). Measured against a real multi-day session transcript, the partial-ratio
 * form was the dominant real violation; the false-positive classes it must not fire on — identifier
 * lists (`ARL-04/05/06/07`, `TC-01/04`), step/round references (`Step 2/3`), decimal scores
 * (`7.7/10`), line references (`lines 54/146`) and completed results (`45/45 scans pass`) — are
 * suppressed explicitly and covered by fixtures.
 *
 * ## Where it runs
 *
 * Only a host that actually ran agent sessions has the channel. On a host with no session
 * transcript directory (CI, a fresh checkout, a worktree that never hosted a session) the scan
 * reports an explicit SKIP with the reason and exits 0 — it never prints a silent pass. A time
 * ratchet (`enforceSinceIso`) bounds enforcement to sessions from adoption onward, so historical
 * conversation — which cannot be edited — is out of scope while new violations are caught.
 *
 * Policy DATA (transcript root, cutoff, keyword/suppression vocabulary) lives under the
 * `progressReportQuantification` key of `.agents/harness.config.json`; this file is the engine.
 *
 * ## It gates nothing in CI, and says so
 *
 * No CI runner has a session transcript, so this scan SKIPS on every CI run. A reader of the suite
 * summary must not take its tick as evidence about a pull request: the only host where it can fail is
 * a developer's own machine. That is stated here rather than left to be rediscovered.
 *
 * ## Why a finding can be acknowledged
 *
 * A transcript is append-only history. A finding cannot be edited away, so without a clearing path
 * the scan is red on that host FOREVER, for every unrelated change — and a guard that fires and
 * cannot be cleared is one that gets suppressed, which costs more than what it catches. So a finding
 * may be acknowledged, with a reason, in a checked-in ledger beside this file.
 *
 * The acknowledgment is anti-rotted: an entry naming a finding that no longer appears FAILS. But
 * only for a transcript this run actually READ — on a host without that transcript the entry is not
 * judged at all, because an anti-rot that fires over ground it never covered is the vacuity this
 * harness spends its time removing.
 *
 * Exit code 0 = clean, skipped, or wholly acknowledged; 1 = unacknowledged violations or a stale
 * acknowledgment.
 */

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import { loadHarnessConfig } from './harness-config.mjs';
import { ADVISORY_MARKER } from './run-all-scans.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
/**
 * What an acknowledgment entry can assert. Both are true statements about a finding; they differ in
 * what is true. `violation` — it happened, the transcript is append-only, it is recorded rather than
 * fixed. `false-positive` — it is not a violation, and the reason says why the scan read it wrong.
 * An entry with no `kind` is a `violation`, which is what every entry written before HARNESS-122
 * meant.
 */
export const ACKNOWLEDGMENT_KINDS = new Set(['violation', 'false-positive']);

const ACKNOWLEDGMENTS_PATH = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/progress-report-acknowledgments.json',
);

/**
 * A finding's identity: which transcript, when, and which ratio.
 *
 * Not the excerpt. The excerpt is prose that a later reader may want to quote differently, and an
 * identity that changes when the quotation is reformatted is an identity that goes stale for the
 * wrong reason.
 */
export function findingKey({ file, transcript, timestamp, ratio }) {
  // A finding calls it `file`, a ledger entry calls it `transcript`. One key reads both, so the two
  // sides cannot drift into producing different identities for the same thing — which they did on
  // first run: every entry read as stale because the key saw an empty filename on one side.
  return `${path.basename(String(file ?? transcript ?? ''))}|${timestamp ?? ''}|${ratio ?? ''}`;
}

export function loadAcknowledgments(readFile = () => readFileSync(ACKNOWLEDGMENTS_PATH, 'utf8')) {
  let raw;
  try {
    raw = readFile();
  } catch (error) {
    // ABSENT is a valid state — a repository with nothing to acknowledge should not have to carry
    // the file. UNREADABLE is not: a permission error or a corrupt read would otherwise become "no
    // acknowledgments", which is a different claim about the same file.
    if (error?.code && error.code !== 'ENOENT') {
      throw new Error(
        `progress-report acknowledgments: ${ACKNOWLEDGMENTS_PATH} could not be read (${error.code}). ` +
          'An unreadable ledger is not an empty one.',
      );
    }
    return [];
  }
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : (parsed.acknowledgments ?? []);
  for (const entry of entries) {
    // A waiver with no reason is a waiver nobody had to justify — the shape this repository refuses
    // wherever it allows a suppression at all.
    if (!entry.reason || String(entry.reason).trim().length === 0) {
      throw new Error(
        `progress-report acknowledgments: ${findingKey(entry)} carries no reason. An acknowledgment ` +
          'without one is a silent waiver.',
      );
    }
    // HARNESS-122 (issue #2339): an entry says WHICH of two true things it is asserting.
    //
    // The ledger used to have one meaning — "a real violation happened here and history cannot be
    // edited". A finding that is not a violation at all had no honest entry: clearing it through the
    // old shape asserted a violation that never occurred, and a ledger for real violations stops
    // meaning anything the first time it absorbs one that is not.
    //
    // The alternative considered and rejected was a pattern rule in the engine. It cannot work here:
    // `완료(8/14)` (a date) and `완료(3/20)` (three of twenty) are the same shape, and the
    // information that separates them is the author's intent, which is not in the text. A guess
    // encoded as a regex trades this false positive for a false negative in the class the scan
    // exists to catch — measured, and caught in review, before this approach replaced it.
    //
    // So the author states which it is, and both statements are true ones.
    if (entry.kind !== undefined && !ACKNOWLEDGMENT_KINDS.has(entry.kind)) {
      throw new Error(
        `progress-report acknowledgments: ${findingKey(entry)} carries kind "${entry.kind}". ` +
          `Valid kinds are ${[...ACKNOWLEDGMENT_KINDS].map((k) => `"${k}"`).join(' and ')}.`,
      );
    }
  }
  return entries;
}

/**
 * Split findings into those an acknowledgment covers and those it does not, and report entries that
 * no longer match anything — but only for transcripts this run actually read.
 */
export function applyAcknowledgments(findings, acknowledgments, transcriptsRead) {
  const acknowledged = new Map(acknowledgments.map((entry) => [findingKey(entry), entry]));
  const matched = new Set();
  const open = [];
  for (const finding of findings) {
    const key = findingKey(finding);
    if (acknowledged.has(key)) matched.add(key);
    else open.push(finding);
  }
  const readable = new Set(transcriptsRead.map((file) => path.basename(file)));
  const stale = acknowledgments.filter(
    (entry) =>
      !matched.has(findingKey(entry)) && readable.has(path.basename(entry.transcript ?? '')),
  );
  // Counted by kind, because a reader of the advisory line needs to know which of the two things
  // the ledger is asserting. "4 acknowledged" hides whether four violations happened or four
  // findings were wrong, and those call for opposite responses.
  const clearedByKind = { violation: 0, 'false-positive': 0 };
  for (const key of matched) {
    clearedByKind[acknowledged.get(key)?.kind ?? 'violation'] += 1;
  }
  return { open, stale, cleared: matched.size, clearedByKind };
}

/** Fenced code blocks and inline code spans are quoted material, not narrative prose. */
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/**
 * Detect bare-ratio progress statements in one narrative message.
 * Returns `[{ line, excerpt, ratio }]`. Pure — the unit under test.
 */
export function findBareRatioProgressStatements(messageText, policy) {
  const completionPattern = new RegExp(policy.completionKeywordPattern, 'i');
  const identifierNounPattern = new RegExp(policy.identifierNounPattern, 'i');
  const identifierNounSuffixPattern = new RegExp(policy.identifierNounSuffixPattern, 'i');
  const findings = [];

  const lines = stripCode(messageText).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!completionPattern.test(line)) continue;
    // The percentage may be anywhere in the same statement — its presence satisfies the rule.
    if (line.includes('%')) continue;

    for (const match of line.matchAll(/\b(\d{1,5})\s*\/\s*(\d{1,5})\b/g)) {
      const [matched, completedRaw, totalRaw] = match;
      const before = line.slice(Math.max(0, match.index - 24), match.index);
      const after = line.slice(match.index + matched.length, match.index + matched.length + 10);
      const completed = Number(completedRaw);
      const total = Number(totalRaw);

      // Only a PARTIAL ratio is a mid-work progress statement. N === M is a completed result
      // ("45/45 scans pass"), which the rule does not ask to be restated as a percentage.
      if (total < 2 || completed >= total) continue;
      // Zero-padded operands are identifiers, not counts (ARL-04/05).
      if (/^0\d/.test(completedRaw) || /^0\d/.test(totalRaw)) continue;
      // Part of a longer slash chain => an identifier list (2/3/5).
      if (/\/\s*$/.test(before) || /^\s*\/\s*\d/.test(after)) continue;
      // Glued to an identifier, a decimal score, or another number (ARL-10/11, 7.7/10, #12/20).
      if (/[A-Za-z#.\-\d]$/.test(before)) continue;
      // Preceded or followed by a noun that makes the pair a reference, not a count
      // (Step 2/3, lines 54/146, "8/9단계").
      if (identifierNounPattern.test(before)) continue;
      if (identifierNounSuffixPattern.test(after)) continue;

      // QUOTED — the ratio is being cited, not asserted. Without this the scan fires on any
      // sentence that discusses a ratio, including a sentence about this scan: measured on
      // 2026-07-26 and again on 2026-07-28, a message reading `제 문장의 "6/7"(버전 번호)을 …
      // 오인해` was itself reported, so writing about the false positive reproduced it. A guard
      // that cannot be discussed without tripping is a guard nobody can fix.
      // Narrow deliberately: a quoted ratio FOLLOWED BY a completion word is asserting completion
      // with the quotes used for emphasis (`'6/7' 완료`), and must still be caught. Only a quoted
      // ratio the sentence then talks ABOUT is a citation.
      const quoted = /["'“‘「『]\s*$/.test(before) && /^\s*["'”’」』]/.test(after);
      // The FIRST TOKEN after the closing quote, not a window of characters.
      //
      // The 10-character `after` slice is sized for short suffix words like `단계`, and a closing
      // quote plus a space eats two of the ten — so `remaining`, `completing`, `converted` and
      // `processed` were truncated before the word boundary could match, the sentence read as a
      // citation, and the violation was dropped. Widening the window instead reached a completion
      // word further along the sentence — `"6/7"(버전 번호)을 진행률 비율로 오인해` contains
      // `진행` — and broke the suppression it was written for. Adjacency is what actually
      // distinguishes the two: `'6/7' 완료` asserts, `"6/7"(...)` is talked about.
      const afterQuote = line
        .slice(match.index + matched.length, match.index + matched.length + 64)
        .replace(/^\s*["'”’」』]\s*/, '');
      const nextToken = /^[^\s.,;:!?()[\]{}]+/.exec(afterQuote)?.[0] ?? '';
      const assertedAfterQuote = completionPattern.test(nextToken);
      if (quoted && !assertedAfterQuote) continue;

      // Preceded by a transition arrow — `5 → 6/7` is a version or state transition, not a count
      // of finished work out of a total. Measured on the same transcript: a line about migrating
      // between tool versions was read as six sevenths of a task being done.
      // A NUMBER must sit before the arrow: `5 → 6/7` is one version to another. `작업 → 6/7 완료`
      // is a progress statement that happens to use an arrow, and stays a violation.
      if (/(?:^|[^\w.])\d[\d.]*\s*(?:->|=>|~>|→|⇒)\s*$/.test(before)) continue;

      findings.push({
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        ratio: `${completed}/${total}`,
      });
      break; // one finding per line is enough to act on
    }
  }
  return findings;
}

/** Extract the narrative text of one transcript record, or '' when it carries none. */
export function extractNarrativeText(record) {
  if (record?.type !== 'assistant') return '';
  const content = record?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function recordTimestampMs(record) {
  const raw = record?.timestamp;
  if (typeof raw !== 'string') return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Scan one transcript JSONL. Streamed line-by-line: session transcripts reach hundreds of MB,
 * so nothing is buffered whole and only assistant records are parsed.
 */
export async function scanTranscriptFile(filePath, policy, sinceMs, stats) {
  const findings = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const raw of lines) {
    if (!raw.includes('"type":"assistant"')) continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      continue; // a truncated tail line is not a rule violation
    }
    const timestampMs = recordTimestampMs(record);
    if (sinceMs !== undefined && timestampMs !== undefined && timestampMs < sinceMs) continue;
    const text = extractNarrativeText(record);
    if (text === '') continue;
    // The examined count is the NARRATIVE MESSAGES actually judged — after the type filter and
    // after the time ratchet — not the transcripts opened (HARNESS-063). A transcript whose every
    // record predates `enforceSinceIso` is a file read and nothing judged.
    if (stats !== undefined) stats.messages += 1;
    for (const finding of findBareRatioProgressStatements(text, policy)) {
      findings.push({ ...finding, file: filePath, timestamp: record?.timestamp });
    }
  }
  return findings;
}

/** Claude-Code-style project slug for a workspace path (every non-alphanumeric run becomes '-'). */
export function transcriptSlugFor(workspacePath) {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Resolve the transcript files to judge. Returns `{ dir, files }`; `files` is empty when this host
 * has no session-transcript channel for this workspace.
 */
export function resolveTranscriptFiles(
  policy,
  { root = WORKSPACE_ROOT, home = os.homedir() } = {},
) {
  const dir = path.join(policy.transcriptRoot.replace(/^~(?=$|\/)/, home), transcriptSlugFor(root));
  if (!existsSync(dir)) return { dir, files: [] };
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => statSync(file).size > 0);
  return { dir, files };
}

function loadPolicy() {
  const policy = loadHarnessConfig().progressReportQuantification;
  if (policy === undefined) {
    throw new Error('missing `progressReportQuantification` policy in .agents/harness.config.json');
  }
  return policy;
}

export async function main(write = (line) => process.stdout.write(`${line}\n`), overrides = {}) {
  const policy = loadPolicy();
  const { dir, files } = resolveTranscriptFiles(policy, overrides);

  if (files.length === 0) {
    // HARNESS-063: the skip reason was already explicit, but a passing scan's stdout is suppressed
    // to a single tick in the suite summary — so on every CI run this line was invisible and the
    // tick was indistinguishable from a scan that had judged the narrative channel. The advisory
    // channel is the one that survives to the summary.
    write(
      `${ADVISORY_MARKER} progress-report quantification examined 0 transcript(s) — no session ` +
        `transcript for this workspace at ${dir}; the agent-narrative channel does not exist on ` +
        'this host (e.g. CI or a fresh checkout), so nothing was judged.',
    );
    // The SKIP declares its zero too, with the reason. Without this the scan is the only one in the
    // suite whose declaration depends on the HOST: present on a machine that has run agent sessions,
    // absent on a fresh checkout — so the adoption count fell by one wherever it actually matters,
    // and the promotion-to-main gate, which runs the suite unskipped on a fresh runner, would have
    // gone red for a count that was correct on the author's laptop. A skip reporting nothing is
    // precisely the shape this declaration exists to make visible.
    write(
      '::examined:: 0 transcripts ::expected-empty:: no session transcript exists on this host, ' +
        'which is every CI runner and every fresh checkout — this scan gates nothing there',
    );
    write(
      `progress-report quantification scan skipped (0 transcript(s), 0 narrative message(s) examined): ` +
        `no session transcript for this workspace at ${dir} ` +
        '(no agent-narrative channel on this host — e.g. CI or a fresh checkout).',
    );
    return 0;
  }

  const sinceMs = Date.parse(policy.enforceSinceIso);
  const findings = [];
  const stats = { messages: 0 };
  for (const file of files) {
    findings.push(...(await scanTranscriptFile(file, policy, sinceMs, stats)));
  }
  const subject = `${files.length} transcript(s), ${stats.messages} narrative message(s) examined`;
  write(
    stats.messages === 0
      ? `::examined:: 0 narrative messages ::expected-empty:: ${files.length} transcript(s) were read ` +
          'and every record fell outside the enforcement ratchet or carried no assistant narrative'
      : `::examined:: ${stats.messages} narrative messages`,
  );

  const { open, stale, cleared, clearedByKind } = applyAcknowledgments(
    findings,
    loadAcknowledgments(),
    files,
  );
  if (stale.length > 0) {
    write('progress-report quantification scan failed — stale acknowledgment(s):');
    for (const entry of stale) {
      write(`  ${findingKey(entry)} no longer matches any finding in a transcript this run read.`);
    }
    write(
      '\nRemove the entry. An acknowledgment that outlives its finding is a waiver nobody is using, ' +
        'and a ledger that only grows stops being read.',
    );
    return 1;
  }
  findings.length = 0;
  findings.push(...open);
  if (cleared > 0) {
    // Split by kind. The two are not interchangeable news: a violation says the rule was broken and
    // the transcript cannot be edited; a false positive says the SCAN was wrong and something here
    // may need fixing. A single total reads as the first and hides the second.
    const parts = [];
    if (clearedByKind.violation > 0) {
      parts.push(
        `${clearedByKind.violation} real violation(s) recorded, not cleared by editing history`,
      );
    }
    if (clearedByKind['false-positive'] > 0) {
      parts.push(
        `${clearedByKind['false-positive']} finding(s) the scan read wrong, each with its reason`,
      );
    }
    write(
      `${ADVISORY_MARKER} progress-report quantification: ${cleared} finding(s) acknowledged in ` +
        `${path.relative(WORKSPACE_ROOT, ACKNOWLEDGMENTS_PATH)} — ${parts.join('; ')}.`,
    );
  }

  if (findings.length === 0) {
    if (stats.messages === 0) {
      write(
        `${ADVISORY_MARKER} progress-report quantification examined 0 narrative messages across ` +
          `${files.length} transcript(s) — every record was filtered out by the ` +
          `enforceSinceIso ratchet (${policy.enforceSinceIso}) or carried no assistant narrative, ` +
          'so this pass judged no message.',
      );
    }
    write(`progress-report quantification scan passed (${subject}).`);
    return 0;
  }

  write(`progress-report quantification scan failed (${subject}):`);
  for (const finding of findings) {
    write(`  ${path.basename(finding.file)} [${finding.timestamp ?? 'no timestamp'}]`);
    write(`    ratio ${finding.ratio} reported without a percentage: "${finding.excerpt}"`);
  }
  write(
    '\nQuantified progress reporting (.agents/rules/agent-conduct.md): a mid-work update over a ' +
      'countable set states the ratio AND the percentage — e.g. "3/7 done = 43%".',
  );
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main().then((code) => {
    process.exitCode = code;
  });
}
