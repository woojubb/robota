import { describe, expect, it, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeTool } from '@robota-sdk/agent-tools';
import { wrapEditCheckpointTools } from '../edit-checkpoint-tools.js';
import type { IEditCheckpointRecorder } from '../edit-checkpoint-types.js';

const TMP_BASE = join(tmpdir(), `robota-edit-checkpoint-tools-${process.pid}`);

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
    const [tool] = wrapEditCheckpointTools([writeTool], recorder);

    await tool?.execute(
      { filePath, content: 'written' },
      { toolName: 'Write', parameters: { filePath, content: 'written' } },
    );

    expect(recorder.captureFile).toHaveBeenCalledTimes(1);
    expect(readFileSync(filePath, 'utf8')).toBe('written');
  });
});
