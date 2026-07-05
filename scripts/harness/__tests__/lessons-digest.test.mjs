import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compactMetrics, runLessonsDigest } from '../lessons-lib.mjs';

const NOW = new Date('2026-05-04T00:00:00.000Z');

const tempRoots = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'robota-lessons-'));
  tempRoots.push(root);
  mkdirSync(path.join(root, '.agents/evals/local-metrics'), { recursive: true });
  return root;
}

function writeJsonl(root, fileName, records) {
  const targetPath = path.join(root, '.agents/evals/local-metrics', fileName);
  writeFileSync(targetPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function readText(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJsonl(root, fileName) {
  return readText(root, `.agents/evals/local-metrics/${fileName}`)
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
}

function runHook(scriptPath, input, projectDir) {
  return spawnSync('bash', [scriptPath], {
    input: JSON.stringify(input),
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      HARNESS_DISABLE_LESSONS_DIGEST: '1',
    },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('auto lessons digest', () => {
  it('regenerates the weekly digest and upserts threshold-crossing auto lessons', async () => {
    const root = createTempRoot();
    const commonMistakesPath = path.join(root, '.agents/rules/common-mistakes.md');
    mkdirSync(path.dirname(commonMistakesPath), { recursive: true });
    writeFileSync(commonMistakesPath, 'human-curated\n');

    writeJsonl(
      root,
      'blocks.jsonl',
      Array.from({ length: 5 }, (_, index) => ({
        timestamp: `2026-05-03T0${index}:00:00.000Z`,
        session_id: 'session-a',
        pattern: 'any-type',
        file: `packages/example/src/file-${index}.ts`,
        escape_attempted: false,
      })),
    );

    await runLessonsDigest({ workspaceRoot: root, now: NOW });
    await runLessonsDigest({ workspaceRoot: root, now: NOW });

    const digest = readText(root, '.agents/evals/lessons/weekly-digest.md');
    const autoLessons = readText(root, '.agents/evals/lessons/auto-lessons.md');

    expect(digest).toContain('`any-type`');
    expect(autoLessons).toContain('<!-- auto-lesson:any-type -->');
    expect(autoLessons.match(/<!-- auto-lesson:any-type -->/g)).toHaveLength(1);
    expect(autoLessons).toContain('Frequency: 5 events in the last 7 days');
    expect(readFileSync(commonMistakesPath, 'utf8')).toBe('human-curated\n');
  });

  it('drops non-repo events (agent memory) and never leaks absolute home paths', async () => {
    const root = createTempRoot();
    // An absolute path OUTSIDE the workspace root — e.g. agent memory under a home dir.
    const outsidePath = path.join(tmpdir(), 'home-user', '.claude', 'memory', 'MEMORY.md');
    writeJsonl(root, 'blocks.jsonl', [
      // 6 repo-relative events for the pattern → counted (>= PROMOTION_THRESHOLD).
      ...Array.from({ length: 6 }, (_, index) => ({
        timestamp: `2026-05-03T0${index}:00:00.000Z`,
        session_id: 'session-c',
        pattern: 'any-type',
        file: `packages/example/src/file-${index}.ts`,
        escape_attempted: false,
      })),
      // 4 non-repo (absolute, outside workspace) events for the same pattern → must be dropped.
      ...Array.from({ length: 4 }, (_, index) => ({
        timestamp: `2026-05-03T1${index}:00:00.000Z`,
        session_id: 'session-c',
        pattern: 'any-type',
        file: outsidePath,
        escape_attempted: false,
      })),
    ]);

    await runLessonsDigest({ workspaceRoot: root, now: NOW });

    const autoLessons = readText(root, '.agents/evals/lessons/auto-lessons.md');
    const digest = readText(root, '.agents/evals/lessons/weekly-digest.md');

    // The absolute non-repo path must never appear in the generated, committed lessons files.
    expect(autoLessons).not.toContain(outsidePath);
    expect(digest).not.toContain(outsidePath);
    expect(autoLessons).not.toContain('/.claude/');
    // Only the 6 repo events are counted; the 4 non-repo events are excluded from frequency.
    expect(autoLessons).toContain('Frequency: 6 events in the last 7 days');
  });

  it('collects block, correction, revert, and session aggregate hook signals', () => {
    const root = createTempRoot();
    const sourcePath = path.join(root, 'packages/example/src/provider.ts');
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, '');

    const blockResult = runHook(
      '.claude/hooks/check-forbidden-patterns.sh',
      {
        session_id: 'session-b',
        tool_input: {
          file_path: sourcePath,
          content: 'const value: any = input;\n',
        },
      },
      root,
    );
    expect(blockResult.status).toBe(2);

    const transcriptPath = path.join(root, 'transcript.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: 'assistant', message: { content: 'Previous answer' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ is_error: true }),
        JSON.stringify({ is_error: true }),
        JSON.stringify({ is_error: true }),
      ].join('\n'),
    );

    const correctionResult = runHook(
      '.claude/hooks/correction-detect.sh',
      {
        session_id: 'session-b',
        transcript_path: transcriptPath,
        prompt: '아니 다시 처리해주세요',
      },
      root,
    );
    expect(correctionResult.status).toBe(0);

    const stopResult = runHook(
      '.claude/hooks/eval-log-stop.sh',
      {
        session_id: 'session-b',
        transcript_path: transcriptPath,
      },
      root,
    );
    expect(stopResult.status).toBe(0);

    const blocks = readJsonl(root, 'blocks.jsonl');
    const corrections = readJsonl(root, 'corrections.jsonl');
    const reverts = readJsonl(root, 'reverts.jsonl');
    const sessions = readJsonl(root, 'sessions.jsonl');
    const expectedHash = createHash('sha256').update('Previous answer').digest('hex');

    expect(blocks[0]).toMatchObject({ session_id: 'session-b', pattern: 'any-type' });
    expect(corrections[0]).toMatchObject({
      session_id: 'session-b',
      pattern: 'user-correction',
      previous_assistant_hash: expectedHash,
    });
    expect(reverts.map((record) => record.pattern).sort()).toEqual([
      'repeated-tool-errors',
      'same-file-edited-3-times',
    ]);
    expect(sessions[0]).toMatchObject({
      session_id: 'session-b',
      blocks_total: 1,
      corrections_total: 1,
      reverts_total: 2,
    });
  });
});

describe('lessons metrics detector quality (LESSON-010)', () => {
  it('a repeated Stop-hook rescan does not re-emit the same revert signals', () => {
    const root = createTempRoot();
    const transcriptPath = path.join(root, 'transcript.jsonl');
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
      ].join('\n'),
    );

    const input = { session_id: 'session-dedupe', transcript_path: transcriptPath };
    expect(runHook('.claude/hooks/revert-detect.sh', input, root).status).toBe(0);
    expect(runHook('.claude/hooks/revert-detect.sh', input, root).status).toBe(0);
    expect(runHook('.claude/hooks/revert-detect.sh', input, root).status).toBe(0);

    const reverts = readJsonl(root, 'reverts.jsonl');
    const sameFile = reverts.filter((record) => record.pattern === 'same-file-edited-3-times');
    expect(sameFile).toHaveLength(1);
  });

  it('workflow-required multi-edit paths (backlog/tasks/lessons) are not rework signals', () => {
    const root = createTempRoot();
    const transcriptPath = path.join(root, 'transcript.jsonl');
    const backlogPath = path.join(root, '.agents/backlog/CORE-999-item.md');
    writeFileSync(
      transcriptPath,
      Array.from({ length: 4 }, () =>
        JSON.stringify({ tool_input: { file_path: backlogPath } }),
      ).join('\n'),
    );

    expect(
      runHook(
        '.claude/hooks/revert-detect.sh',
        { session_id: 'session-wf', transcript_path: transcriptPath },
        root,
      ).status,
    ).toBe(0);

    let reverts = [];
    try {
      reverts = readJsonl(root, 'reverts.jsonl');
    } catch {
      // no file written at all is also a pass
    }
    expect(reverts.filter((r) => r.pattern === 'same-file-edited-3-times')).toHaveLength(0);
  });

  it('repeated-tool-errors captures which tools failed instead of "(none)"', () => {
    const root = createTempRoot();
    const transcriptPath = path.join(root, 'transcript.jsonl');
    const lines = [];
    for (let i = 1; i <= 3; i += 1) {
      lines.push(
        JSON.stringify({
          message: { content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: {} }] },
        }),
        JSON.stringify({
          message: { content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: true }] },
        }),
      );
    }
    writeFileSync(transcriptPath, lines.join('\n'));

    expect(
      runHook(
        '.claude/hooks/revert-detect.sh',
        { session_id: 'session-errs', transcript_path: transcriptPath },
        root,
      ).status,
    ).toBe(0);

    const reverts = readJsonl(root, 'reverts.jsonl');
    const errorEvent = reverts.find((record) => record.pattern === 'repeated-tool-errors');
    expect(errorEvent?.detail).toContain('failing tools: Bash(3)');
  });

  it('agent-authored and session-less prompts are not user corrections', () => {
    const root = createTempRoot();

    for (const sessionId of ['agent_1', '']) {
      expect(
        runHook(
          '.claude/hooks/correction-detect.sh',
          { session_id: sessionId, prompt: '다른 말은 하지 마세요' },
          root,
        ).status,
      ).toBe(0);
    }

    let corrections = [];
    try {
      corrections = readJsonl(root, 'corrections.jsonl');
    } catch {
      // no file written is the expected outcome
    }
    expect(corrections).toHaveLength(0);
  });

  it('compactMetrics collapses per-Stop duplicates and drops beyond-retention records', async () => {
    const root = createTempRoot();
    writeJsonl(root, 'reverts.jsonl', [
      // 4 per-Stop re-emissions of the same signal, count growing — keep only the last.
      ...Array.from({ length: 4 }, (_, index) => ({
        timestamp: `2026-05-03T0${index}:00:00.000Z`,
        session_id: 'session-x',
        pattern: 'same-file-edited-3-times',
        file: 'packages/example/src/a.ts',
        count: 3 + index,
        detail: 'same file edited repeatedly',
      })),
      // Beyond the 30-day retention window — dropped.
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        session_id: 'session-old',
        pattern: 'same-file-edited-3-times',
        file: 'packages/example/src/old.ts',
        count: 3,
        detail: 'same file edited repeatedly',
      },
    ]);

    const results = await compactMetrics({ workspaceRoot: root, now: NOW });

    const reverts = readJsonl(root, 'reverts.jsonl');
    expect(reverts).toHaveLength(1);
    expect(reverts[0]).toMatchObject({ session_id: 'session-x', count: 6 });
    expect(results.find((entry) => entry.file === 'reverts.jsonl')).toMatchObject({
      before: 5,
      after: 1,
    });
  });

  it('auto-lessons sections below threshold in the current window are dropped, not left stale', async () => {
    const root = createTempRoot();
    const lessonsDir = path.join(root, '.agents/evals/lessons');
    mkdirSync(lessonsDir, { recursive: true });
    writeFileSync(
      path.join(lessonsDir, 'auto-lessons.md'),
      [
        '# Auto Lessons',
        '',
        'Generated candidate lessons from local hook metrics.',
        'Do not promote entries to `.agents/rules/common-mistakes.md` without human review.',
        '',
        '<!-- auto-lesson:ghost-pattern -->',
        '## ghost-pattern',
        '',
        '- Frequency: 15 events in the last 7 days',
        '- Sources: reverts',
        '- Example paths: (none)',
        '- First seen: 2026-01-01T00:00:00.000Z',
        '- Last seen: 2026-01-02T00:00:00.000Z',
        '- Status: candidate; human review is required before promotion.',
        '',
      ].join('\n'),
    );
    writeJsonl(
      root,
      'blocks.jsonl',
      Array.from({ length: 5 }, (_, index) => ({
        timestamp: `2026-05-03T0${index}:00:00.000Z`,
        session_id: 'session-live',
        pattern: 'live-pattern',
        file: `packages/example/src/file-${index}.ts`,
      })),
    );

    await runLessonsDigest({ workspaceRoot: root, now: NOW });

    const autoLessons = readText(root, '.agents/evals/lessons/auto-lessons.md');
    expect(autoLessons).toContain('<!-- auto-lesson:live-pattern -->');
    expect(autoLessons).not.toContain('ghost-pattern');
  });

  it('path-less signals surface their detail as the digest example', async () => {
    const root = createTempRoot();
    writeJsonl(root, 'reverts.jsonl', [
      {
        timestamp: '2026-05-03T00:00:00.000Z',
        session_id: 'session-d',
        pattern: 'repeated-tool-errors',
        file: '',
        count: 12,
        detail: 'failing tools: Bash(9),Edit(3)',
      },
    ]);

    await runLessonsDigest({ workspaceRoot: root, now: NOW });

    const digest = readText(root, '.agents/evals/lessons/weekly-digest.md');
    expect(digest).toContain('failing tools: Bash(9),Edit(3)');
    expect(digest).not.toContain('(none)');
  });
});

describe('legacy false-positive purge (LESSON-010)', () => {
  it('compaction drops workflow-path same-file records and agent/session-less corrections', async () => {
    const root = createTempRoot();
    writeJsonl(root, 'reverts.jsonl', [
      {
        timestamp: '2026-05-03T00:00:00.000Z',
        session_id: 's1',
        pattern: 'same-file-edited-3-times',
        file: '.agents/backlog/CORE-999-item.md',
        count: 8,
        detail: 'same file edited repeatedly',
      },
      {
        timestamp: '2026-05-03T00:00:00.000Z',
        session_id: 's1',
        pattern: 'same-file-edited-3-times',
        file: 'packages/example/src/a.ts',
        count: 3,
        detail: 'same file edited repeatedly',
      },
    ]);
    writeJsonl(root, 'corrections.jsonl', [
      {
        timestamp: '2026-05-03T00:00:00.000Z',
        session_id: 'agent_1',
        pattern: 'user-correction',
        prompt_excerpt: 'x',
      },
      {
        timestamp: '2026-05-03T00:00:00.000Z',
        session_id: '',
        pattern: 'user-correction',
        prompt_excerpt: 'y',
      },
      {
        timestamp: '2026-05-03T00:00:00.000Z',
        session_id: 'real-session',
        pattern: 'user-correction',
        prompt_excerpt: 'z',
      },
    ]);

    await compactMetrics({ workspaceRoot: root, now: NOW });

    const reverts = readJsonl(root, 'reverts.jsonl');
    expect(reverts).toHaveLength(1);
    expect(reverts[0].file).toBe('packages/example/src/a.ts');

    const corrections = readJsonl(root, 'corrections.jsonl');
    expect(corrections).toHaveLength(1);
    expect(corrections[0].session_id).toBe('real-session');
  });
});
