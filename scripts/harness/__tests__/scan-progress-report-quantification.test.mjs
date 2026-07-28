import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadHarnessConfig } from '../harness-config.mjs';
import {
  extractNarrativeText,
  findBareRatioProgressStatements,
  main,
  resolveTranscriptFiles,
  scanTranscriptFile,
  transcriptSlugFor,
} from '../scan-progress-report-quantification.mjs';

/** The SHIPPED policy — the fixtures prove the vocabulary that actually runs, not a stand-in. */
const POLICY = loadHarnessConfig().progressReportQuantification;

const tempDirs = [];
function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'progress-report-scan-'));
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
    expect(lines.join('\n')).toContain('skipped: no session transcript');
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
