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
 * Exit code 0 = clean or skipped, 1 = violations found.
 */

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import { loadHarnessConfig } from './harness-config.mjs';
import { ADVISORY_MARKER } from './run-all-scans.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
