import { existsSync, mkdirSync, rmSync, readFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWriteTool } from '@robota-sdk/agent-tools';
import { describe, expect, it, afterEach, vi } from 'vitest';

import { wrapEditCheckpointTools } from '../edit-checkpoint-tools.js';

import type { IEditCheckpointRecorder } from '../edit-checkpoint-types.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-edit-checkpoint-tools-')));

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('wrapEditCheckpointTools', () => {
  it('Given a Write tool wrapper When the tool writes a file Then it captures the pre-image before writing', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'output.txt');
    const recorder: IEditCheckpointRecorder = {
      captureFile: vi.fn(async (target) => {
        expect(target).toBe(filePath);
        expect(existsSync(filePath)).toBe(false);
      }),
    };
    // ARCH-010 — the context-free `writeTool` singleton is gone and the root is a required constructor
    // argument. It is the per-case project directory, which is exactly where `filePath` lives.
    const [tool] = wrapEditCheckpointTools([createWriteTool({ cwd })], recorder);

    await tool?.execute(
      { filePath, content: 'written' },
      { toolName: 'Write', parameters: { filePath, content: 'written' } },
    );

    expect(recorder.captureFile).toHaveBeenCalledTimes(1);
    expect(readFileSync(filePath, 'utf8')).toBe('written');
  });
});
