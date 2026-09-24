import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { renderSupervisedSessionView } from '@robota-sdk/agent-ui-terminal';

import { runSessionViewCommand } from '../session-view-command.js';
import { listSupervisedSessions, startSupervisedControl } from '../supervised-session-control.js';

describe('session view command', () => {
  it('passes the verified global supervised inventory to its presentation without session content', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-view-'));
    const root = join(scratch, 'supervised');
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    const control = await startSupervisedControl(id, () => undefined, root, () => 'working');
    let observed: unknown;
    try {
      const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
        observed = await options.loadRows(new AbortController().signal);
      });
      expect(await runSessionViewCommand([], {
        isTTY: true, settings: {}, env: {}, root, render,
      })).toBe(0);
      expect(observed).toEqual([{ id, liveness: 'alive', control: 'available', activity: 'working' }]);
      expect(JSON.stringify(observed)).not.toMatch(/prompt|token|transcript|cwd/i);
      expect(await listSupervisedSessions(root)).toEqual(observed);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('honors settings, environment, and flag precedence before rendering', async () => {
    const render = vi.fn(async () => undefined);
    expect(await runSessionViewCommand(['--screen-reader'], {
      isTTY: true,
      settings: { screenReader: true },
      env: { ROBOTA_SCREEN_READER: '0' },
      render,
    })).toBe(0);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      screenReader: true,
      screenReaderChannel: 'flag',
    }));
    render.mockClear();
    expect(await runSessionViewCommand(['--no-screen-reader'], {
      isTTY: true,
      settings: { screenReader: true },
      env: { ROBOTA_SCREEN_READER: '1' },
      render,
    })).toBe(0);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ screenReader: false }));
  });

  it('does not start an interactive renderer when input or output is not a TTY', async () => {
    const render = vi.fn(async () => undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runSessionViewCommand([], { isTTY: false, render })).toBe(1);
      expect(render).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([value]) => String(value)).join('')).toMatch(/TTY.*session list/i);
    } finally {
      stderr.mockRestore();
    }
  });
});
