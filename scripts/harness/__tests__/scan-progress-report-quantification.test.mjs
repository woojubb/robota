import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { loadHarnessConfig } from '../harness-config.mjs';
import { ADVISORY_MARKER } from '../run-all-scans.mjs';
import {
  ACKNOWLEDGMENT_KINDS,
  applyAcknowledgments,
  extractNarrativeText,
  findBareRatioProgressStatements,
  findingKey,
  loadAcknowledgments,
  main,
  resolveTranscriptFiles,
  scanTranscriptFile,
  transcriptSlugFor,
} from '../scan-progress-report-quantification.mjs';

/** The SHIPPED policy — the fixtures prove the vocabulary that actually runs, not a stand-in. */
const POLICY = loadHarnessConfig().progressReportQuantification;

const tempDirs = [];
function makeTempDir() {
  const dir = makeTemp('progress-report-scan-');
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

function assistantRecord(text, timestamp = '2026-07-26T10:00:00.000Z') {
  return JSON.stringify({
    type: 'assistant',
    timestamp,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

describe('findBareRatioProgressStatements — the rule', () => {
  it('FAILS a mid-work progress report that states a ratio without a percentage', () => {
    const findings = findBareRatioProgressStatements('Audit 3/7 done. Continuing.', POLICY);
    expect(findings).toHaveLength(1);
    expect(findings[0].ratio).toBe('3/7');
  });

  it('PASSES the same report once it states the ratio AND the percentage', () => {
    expect(
      findBareRatioProgressStatements('Audit 3/7 done = 43%. Continuing.', POLICY),
    ).toHaveLength(0);
  });

  it('FAILS a Korean progress report with a bare ratio', () => {
    expect(findBareRatioProgressStatements('감사 2/5 완료. 계속 진행합니다.', POLICY)).toHaveLength(
      1,
    );
  });

  it('reports the offending line number and an excerpt to act on', () => {
    const [finding] = findBareRatioProgressStatements(
      'Kicking off.\nMigration 4/9 complete so far.',
      POLICY,
    );
    expect(finding.line).toBe(2);
    expect(finding.excerpt).toContain('Migration 4/9 complete');
  });
});

describe('findBareRatioProgressStatements — measured false-positive classes stay silent', () => {
  it('stays silent on a ratio that is being QUOTED rather than asserted', () => {
    // Measured 2026-07-26 and again 2026-07-28: a message about this scan's own false positive —
    // `제 문장의 "6/7"(버전 번호)을 진행률 비율로 오인해` — was itself reported. Writing about the
    // defect reproduced it, and the scan blocked the release gate both times. A guard that cannot
    // be discussed without tripping is a guard nobody can fix.
    expect(
      findBareRatioProgressStatements(
        '스캔이 제 문장의 "6/7"(버전 번호)을 진행률 비율로 오인해 막고 있습니다',
        POLICY,
      ),
    ).toHaveLength(0);
  });

  it('still catches a real progress report that happens to use an arrow', () => {
    // The suppression is for a version transition, `5 → 6/7`, where a NUMBER sits before the arrow.
    // An arrow used as ordinary punctuation must not become a way to write a bare ratio — and a
    // test covering only the suppressed shape would pass whether or not that held.
    expect(
      findBareRatioProgressStatements('마이그레이션 작업 → 6/7 완료. 계속합니다.', POLICY),
    ).toHaveLength(1);
  });

  it('still catches a quoted report whose keyword is a long word', () => {
    // The suppression tested the 10-character `after` slice, which a closing quote and a space cut
    // to seven or eight — so `remaining`, `completing`, `converted` and `processed` were truncated
    // before the word boundary could match and the violation was dropped. Only `완료` (two
    // characters) was covered, which is why the shipped tests did not see it.
    for (const keyword of ['remaining', 'completing', 'converted', 'processed']) {
      expect(
        findBareRatioProgressStatements(`'6/7' ${keyword}, continuing later`, POLICY),
        keyword,
      ).toHaveLength(1);
    }
  });

  it('still catches a real progress report quoted for emphasis', () => {
    // The quote suppression is for a ratio the sentence talks ABOUT. Quotes used for emphasis
    // around an asserted ratio — `'6/7' 완료` — are still an assertion, and still a violation.
    expect(findBareRatioProgressStatements("'6/7' 완료. 계속 진행합니다.", POLICY)).toHaveLength(1);
  });

  it('stays silent on a version transition written with an arrow', () => {
    // `5 → 6/7` is a transition between tool versions, not six sevenths of a task finished.
    expect(
      findBareRatioProgressStatements('**5 → 6/7 병행 전환 완료.** 타입체크·빌드는 통과', POLICY),
    ).toHaveLength(0);
  });

  it.each([
    ['completed result, not mid-work progress', '45/45 scans pass — all green, work complete.'],
    ['identifier list', 'ARL-04/05/06/07 resolved and moved to done.'],
    ['hyphenated identifier pair', 'ARL-10/11 remaining as decision items.'],
    ['slash-separated identifier chain', 'Scenarios 1/2/3/5 passed; the run is complete.'],
    ['step reference', 'Let me commit Step 4/5 — the lint pass is done.'],
    ['stage reference', 'Stage 2/3 wiring is what remains.'],
    ['trailing step noun', '네 교훈 배선 완료. lesson-to-harness 8/9단계(메커니즘·검증) 적용.'],
    ['trailing English step noun', 'Wiring done at 8/9 steps of the skill.'],
    ['decimal score', 'health: DONE (7.7/10 composite).'],
    ['line reference', 'It reads process.md (lines 54/146), so the fold is not done.'],
    ['ratio inside an inline code span', 'The helper `ratio(3/7)` is done.'],
    ['no completion context at all', 'The 3/7 split of the payload arrives over the wire.'],
  ])('does not fire on a %s', (_label, text) => {
    expect(findBareRatioProgressStatements(text, POLICY)).toHaveLength(0);
  });

  it('ignores ratios inside fenced code blocks', () => {
    const text = ['Refactor complete.', '```', 'const remaining = 3/7; // done', '```'].join('\n');
    expect(findBareRatioProgressStatements(text, POLICY)).toHaveLength(0);
  });

  it('leaves a bare unquantified "making progress" to the prose rule (documented scope limit)', () => {
    expect(findBareRatioProgressStatements('Making progress on the audit.', POLICY)).toHaveLength(
      0,
    );
  });
});

describe('extractNarrativeText', () => {
  it('returns the assistant text blocks only', () => {
    const text = extractNarrativeText({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'private reasoning 3/7 done' },
          { type: 'text', text: 'visible narrative' },
          { type: 'tool_use', name: 'Bash', input: {} },
        ],
      },
    });
    expect(text).toBe('visible narrative');
  });

  it('returns empty for non-assistant records', () => {
    expect(extractNarrativeText({ type: 'user', message: { content: '5/9 done' } })).toBe('');
  });
});

describe('scanTranscriptFile', () => {
  it('FAILS on a transcript containing a bare-ratio progress report and PASSES once fixed', async () => {
    const dir = makeTempDir();
    const violating = path.join(dir, 'violating.jsonl');
    writeFileSync(
      violating,
      [
        JSON.stringify({ type: 'user', message: { content: 'go' } }),
        assistantRecord('Sweep 3/7 done, continuing.'),
      ].join('\n'),
    );
    expect(await scanTranscriptFile(violating, POLICY, undefined)).toHaveLength(1);

    const compliant = path.join(dir, 'compliant.jsonl');
    writeFileSync(compliant, assistantRecord('Sweep 3/7 done = 43%, continuing.'));
    expect(await scanTranscriptFile(compliant, POLICY, undefined)).toHaveLength(0);
  });

  it('honours the enforceSinceIso time ratchet (history is out of scope)', async () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'session.jsonl');
    writeFileSync(
      file,
      [
        assistantRecord('Old sweep 1/4 done.', '2026-01-01T00:00:00.000Z'),
        assistantRecord('New sweep 2/4 done.', '2026-07-26T00:00:00.000Z'),
      ].join('\n'),
    );
    const cutoff = Date.parse('2026-07-25T00:00:00Z');
    const findings = await scanTranscriptFile(file, POLICY, cutoff);
    expect(findings.map((f) => f.ratio)).toEqual(['2/4']);
  });

  it('ignores a truncated tail line instead of crashing', async () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'truncated.jsonl');
    writeFileSync(file, `${assistantRecord('All good = 100%.')}\n{"type":"assistant","mes`);
    await expect(scanTranscriptFile(file, POLICY, undefined)).resolves.toHaveLength(0);
  });
});

describe('channel resolution', () => {
  it('slugifies a workspace path the way the session transcript directory is named', () => {
    expect(transcriptSlugFor('/home/dev/repo')).toBe('-home-dev-repo');
  });

  it('reports no files when this host has no transcript directory for the workspace', () => {
    const home = makeTempDir();
    const { files } = resolveTranscriptFiles(POLICY, { root: '/home/dev/repo', home });
    expect(files).toEqual([]);
  });

  it('finds the workspace transcripts when the channel exists', () => {
    const home = makeTempDir();
    const dir = path.join(home, '.claude', 'projects', transcriptSlugFor('/home/dev/repo'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.jsonl'), assistantRecord('hi'));
    const { files } = resolveTranscriptFiles(POLICY, { root: '/home/dev/repo', home });
    expect(files.map((f) => path.basename(f))).toEqual(['a.jsonl']);
  });
});

describe('main', () => {
  it('SKIPS with an explicit reason (never a silent pass) when the channel is absent', async () => {
    const lines = [];
    const code = await main((line) => lines.push(line), {
      root: '/home/dev/repo',
      home: makeTempDir(),
    });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('scan skipped');
    expect(lines.join('\n')).toContain('no session transcript for this workspace');
  });

  /**
   * HARNESS-063 — the skip states its zero, through the channel that survives to the suite summary.
   * A passing scan's stdout is suppressed to a single tick, so on CI (where this channel never
   * exists) the explicit skip reason was invisible and the tick read as a verified rule.
   */
  it('reports 0 transcripts and raises an advisory when the channel is absent', async () => {
    const lines = [];
    const code = await main((line) => lines.push(line), {
      root: '/home/dev/repo',
      home: makeTempDir(),
    });
    const output = lines.join('\n');
    expect(code).toBe(0);
    expect(output).toContain('skipped (0 transcript(s), 0 narrative message(s) examined)');
    expect(output).toContain(
      `${ADVISORY_MARKER} progress-report quantification examined 0 transcript(s)`,
    );
  });

  it('reports the number of transcripts AND narrative messages it judged', async () => {
    const home = makeTempDir();
    const dir = path.join(home, '.claude', 'projects', transcriptSlugFor('/home/dev/repo'));
    mkdirSync(dir, { recursive: true });
    const recent = POLICY.enforceSinceIso.replace(/^(\d{4})/, (year) => String(Number(year) + 1));
    writeFileSync(
      path.join(dir, 'a.jsonl'),
      [
        assistantRecord('All good = 100%.', recent),
        JSON.stringify({ type: 'user', message: { content: 'go' } }),
        assistantRecord('Second message, nothing countable here.', recent),
      ].join('\n'),
    );
    writeFileSync(path.join(dir, 'b.jsonl'), assistantRecord('Third, still clean.', recent));

    const lines = [];
    const code = await main((line) => lines.push(line), { root: '/home/dev/repo', home });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain(
      'progress-report quantification scan passed (2 transcript(s), 3 narrative message(s) examined)',
    );
    expect(lines.join('\n')).not.toContain(ADVISORY_MARKER);
  });

  it('raises an advisory when transcripts exist but the ratchet leaves 0 messages to judge', async () => {
    const home = makeTempDir();
    const dir = path.join(home, '.claude', 'projects', transcriptSlugFor('/home/dev/repo'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'ancient.jsonl'),
      assistantRecord('Sweep 3/7 done.', '2000-01-01T00:00:00.000Z'),
    );

    const lines = [];
    const code = await main((line) => lines.push(line), { root: '/home/dev/repo', home });
    const output = lines.join('\n');
    expect(code).toBe(0);
    expect(output).toContain('scan passed (1 transcript(s), 0 narrative message(s) examined)');
    expect(output).toContain(
      `${ADVISORY_MARKER} progress-report quantification examined 0 narrative messages`,
    );
  });

  it('exits 1 and names the rule when a transcript violates it', async () => {
    const home = makeTempDir();
    const dir = path.join(home, '.claude', 'projects', transcriptSlugFor('/home/dev/repo'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'session.jsonl'), assistantRecord('Sweep 3/7 done, continuing.'));

    const lines = [];
    const code = await main((line) => lines.push(line), { root: '/home/dev/repo', home });
    expect(code).toBe(1);
    const output = lines.join('\n');
    expect(output).toContain('3/7');
    expect(output).toContain('agent-conduct.md');
  });
});

describe('the version-migration form, judged deliberately', () => {
  /**
   * HARNESS-054 asked for this verdict to be STATED rather than left to fall out of a lookbehind
   * width. It is two verdicts, and they differ on what sits before the arrow.
   */
  it('suppresses a version transition and flags a progress statement wearing an arrow', () => {
    // A NUMBER before the arrow is a version or state transition: `5 → 6/7` is one version to
    // another, not six sevenths of a task finished.
    expect(findBareRatioProgressStatements('**5 → 6/7 병행 전환 완료.**', POLICY)).toEqual([]);
    expect(
      findBareRatioProgressStatements('TypeScript 5 → 6/7 migration complete.', POLICY),
    ).toEqual([]);

    // A WORD before it is not. The arrow does not make a count into a version.
    expect(findBareRatioProgressStatements('마이그레이션 작업 → 6/7 완료.', POLICY)).toHaveLength(
      1,
    );
  });

  it('still flags the prose form, and that is the deliberate answer', () => {
    // `from v5 to 6/7` reads as a version pair to someone who knows the domain, and the version noun
    // is not adjacent to the ratio. The item proposed widening the suppression to SENTENCE scope for
    // the version nouns; that is refused here, on this evidence: it would suppress a real finding in
    // any sentence that happens to mention a version, and the next case is exactly that sentence.
    //
    // The writer has two ways to say it without tripping the rule — the arrow form above, or the
    // percentage the rule asks for. A false positive with two cheap escapes is a better trade than a
    // class of false negatives with none.
    expect(findBareRatioProgressStatements('Migrated from v5 to 6/7 — done.', POLICY)).toHaveLength(
      1,
    );
  });

  it('would have lost a real finding under sentence-scope suppression', () => {
    // The sentence that decides it: a genuine mid-work ratio, in a message that also mentions a
    // version. Sentence scope would have read the version noun and dropped the violation.
    expect(
      findBareRatioProgressStatements('작업 4/6 완료. 버전 5도 확인했습니다.', POLICY),
    ).toHaveLength(1);
  });
});

describe('a finding in append-only history can be acknowledged, and the ledger cannot rot', () => {
  /**
   * A transcript cannot be edited, so a finding here is permanent: without a clearing path the scan
   * is red on that host forever, for every unrelated change. A guard that fires and cannot be
   * cleared is one that gets suppressed, and a suppressed guard costs more than what it catches.
   */
  const FINDING = {
    file: '/somewhere/session.jsonl',
    timestamp: '2026-08-01T00:00:00.000Z',
    ratio: '4/6',
  };
  const ENTRY = {
    transcript: 'session.jsonl',
    timestamp: '2026-08-01T00:00:00.000Z',
    ratio: '4/6',
    reason: 'why',
  };

  it('identifies a finding the same way from either side', () => {
    // A finding calls it `file`, a ledger entry calls it `transcript`. Two keys for one thing means
    // every entry reads stale — measured on the first run of this ledger, where all of them did.
    expect(findingKey(FINDING)).toBe(findingKey(ENTRY));
  });

  it('does not key on the excerpt', () => {
    // The excerpt is prose a later reader may requote. An identity that changes when the quotation
    // is reformatted goes stale for the wrong reason.
    expect(findingKey({ ...FINDING, excerpt: 'one wording' })).toBe(
      findingKey({ ...FINDING, excerpt: 'another wording entirely' }),
    );
  });

  it('clears a finding it covers, and leaves the rest open', () => {
    const other = { ...FINDING, ratio: '5/6' };
    const result = applyAcknowledgments([FINDING, other], [ENTRY], [FINDING.file]);

    expect(result.cleared).toBe(1);
    expect(result.open).toEqual([other]);
    expect(result.stale).toEqual([]);
  });

  it('fails an entry whose finding no longer appears', () => {
    expect(applyAcknowledgments([], [ENTRY], [FINDING.file]).stale).toEqual([ENTRY]);
  });

  it('does NOT judge an entry for a transcript this run never read', () => {
    // The anti-rot must be scoped to the real subject. On a host without that transcript — CI, a
    // fresh checkout, another developer's machine — every entry would read stale, and a check that
    // fires over ground it never covered is the vacuity this harness spends its time removing.
    expect(applyAcknowledgments([], [ENTRY], []).stale).toEqual([]);
  });

  it('refuses an acknowledgment with no reason', () => {
    // A waiver nobody had to justify is the shape this repository refuses wherever it allows one.
    expect(() => loadAcknowledgments(() => JSON.stringify([{ ...ENTRY, reason: '   ' }]))).toThrow(
      /carries no reason/,
    );
  });

  it('refuses an UNREADABLE ledger, which is a different claim from an absent one', () => {
    // A permission error or a corrupt read would otherwise become "no acknowledgments" — the same
    // file, a different claim. Absent is a valid state; unreadable is not.
    expect(() =>
      loadAcknowledgments(() => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    ).toThrow(/could not be read/);
  });

  it('treats a missing ledger as an empty one, not as an error', () => {
    // The ledger is optional: a repository with nothing to acknowledge should not have to carry a file.
    expect(
      loadAcknowledgments(() => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }),
    ).toEqual([]);
  });

  it('reads the SHIPPED ledger, so a malformed one fails here rather than in CI', () => {
    expect(() => loadAcknowledgments()).not.toThrow();
  });
});

describe('HARNESS-122: an entry says which of two true things it asserts', () => {
  /**
   * The ledger had one meaning — "a real violation happened and history cannot be edited". A finding
   * that is not a violation had no honest entry, so clearing it asserted a violation that never
   * occurred. A ledger for real violations stops meaning anything the first time it absorbs one that
   * is not.
   *
   * The rejected alternative was a pattern rule in the engine. `완료(8/14)` (a date) and
   * `완료(3/20)` (three of twenty) are the same shape, and what separates them is the author's
   * intent, which is not in the text — so the guard silently dropped genuine progress statements
   * with denominators in the suppressed band. Caught in review of PR #2341 and withdrawn.
   */
  const FINDING = {
    file: '/somewhere/session.jsonl',
    timestamp: '2026-08-01T00:00:00.000Z',
    ratio: '8/14',
  };
  const base = { transcript: 'session.jsonl', timestamp: FINDING.timestamp, ratio: '8/14' };

  it('clears a finding marked as a false positive', () => {
    const entry = { ...base, kind: 'false-positive', reason: '8/14 is a date' };
    const result = applyAcknowledgments([FINDING], [entry], [FINDING.file]);

    expect(result.open).toEqual([]);
    expect(result.clearedByKind['false-positive']).toBe(1);
    expect(result.clearedByKind.violation).toBe(0);
  });

  it('counts an entry with no kind as a violation, which is what every entry before this meant', () => {
    // The backward-compatibility case. Without it, adding the field would silently reclassify the
    // ledger's whole existing contents.
    const entry = { ...base, reason: 'a real one' };
    const result = applyAcknowledgments([FINDING], [entry], [FINDING.file]);

    expect(result.clearedByKind.violation).toBe(1);
    expect(result.clearedByKind['false-positive']).toBe(0);
  });

  it('separates the two kinds in one ledger rather than reporting a single total', () => {
    // The reason the split exists: a violation says the rule was broken; a false positive says the
    // SCAN is wrong and something may need fixing. One total reads as the first and hides the second.
    const otherFinding = { ...FINDING, ratio: '4/6' };
    const entries = [
      { ...base, kind: 'false-positive', reason: 'a date' },
      { ...base, ratio: '4/6', reason: 'a real one' },
    ];
    const result = applyAcknowledgments([FINDING, otherFinding], entries, [FINDING.file]);

    expect(result.cleared).toBe(2);
    expect(result.clearedByKind).toEqual({ violation: 1, 'false-positive': 1 });
  });

  it('REFUSES an entry whose kind is not one of the two', () => {
    // A typo — `false-postive` — would otherwise fall through the `?? 'violation'` default and clear
    // the finding while counted as a violation: the exact silent miscount this field exists to stop.
    const json = JSON.stringify({
      acknowledgments: [{ ...base, kind: 'false-postive', reason: 'a date' }],
    });
    expect(() => loadAcknowledgments(() => json)).toThrow(/kind "false-postive"/);
  });

  it('accepts both valid kinds through the loader', () => {
    // The positive control. Without it the refusal above passes against a loader that rejects every
    // kind, including the two the ledger now depends on.
    const json = JSON.stringify({
      acknowledgments: [
        { ...base, kind: 'false-positive', reason: 'a date' },
        { ...base, ratio: '4/6', kind: 'violation', reason: 'a real one' },
      ],
    });
    expect(loadAcknowledgments(() => json)).toHaveLength(2);
  });

  it('admits exactly two kinds', () => {
    // Pinned as data in both directions, so a third value cannot be added to the vocabulary without
    // a test saying what it means, and neither can be removed silently.
    expect([...ACKNOWLEDGMENT_KINDS].sort()).toEqual(['false-positive', 'violation']);
  });
});

describe('what it declares does not depend on the host it runs on', () => {
  it('declares a zero WITH its reason when there is no transcript at all', async () => {
    // The skip branch printed no declaration, so this was the one scan in the suite whose
    // `::examined::` line appeared on a machine that had run agent sessions and vanished on a fresh
    // checkout. The adoption ratchet counts that line, and the promotion-to-main gate runs the suite
    // unskipped on a fresh runner — so a count that was correct on the author's laptop would have
    // turned that gate red. Review traced it; the local green could not have shown it.
    const lines = [];
    const code = await main((line) => lines.push(line), {
      root: '/home/dev/repo',
      home: makeTempDir(),
    });

    const printed = lines.join('\n');
    expect(code, 'a host without transcripts must still skip cleanly').toBe(0);
    expect(printed, 'the skip declared nothing, so its adoption depends on the host').toMatch(
      /::examined:: 0 transcripts ::expected-empty::/,
    );
  });
});
