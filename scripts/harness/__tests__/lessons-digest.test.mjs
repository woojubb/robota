import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runLessonsDigest } from '../lessons-lib.mjs';

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
      ROBOTA_DISABLE_LESSONS_DIGEST: '1',
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
