import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
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

  it('passes selected stop requests to the guarded owner-control operation', async () => {
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    const stop = vi.fn(async () => undefined);
    const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
      expect(options).toHaveProperty('onStop');
      await options.onStop?.(id);
    });
    expect(await runSessionViewCommand([], {
      isTTY: true, settings: {}, env: {}, root: '/tmp/supervised-view-test', render, stop,
    })).toBe(0);
    expect(stop).toHaveBeenCalledExactlyOnceWith(id, '/tmp/supervised-view-test');
  });

  it('accepts a cwd filter with screen-reader flags and shows only verified matching sessions', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-view-cwd-'));
    const root = join(scratch, 'supervised');
    const project = join(scratch, 'project');
    const other = join(scratch, 'other');
    const projectLink = join(scratch, 'project-link');
    mkdirSync(project);
    mkdirSync(other);
    symlinkSync(project, projectLink, 'dir');
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    const control = await startSupervisedControl(id, () => undefined, root, undefined, () => realpathSync(project));
    const observed: unknown[] = [];
    const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
      expect(options.filteredByCwd).toBe(true);
      observed.push(await options.loadRows(new AbortController().signal));
    });
    try {
      expect(await runSessionViewCommand(['--screen-reader', '--cwd', project], {
        isTTY: true, settings: {}, env: {}, root, render,
      })).toBe(0);
      expect(observed[0]).toEqual([
        { id, liveness: 'alive', control: 'available', activity: 'unknown' },
      ]);
      expect(await runSessionViewCommand(['--cwd', other, '--no-screen-reader'], {
        isTTY: true, settings: {}, env: {}, root, render,
      })).toBe(0);
      expect(observed[1]).toEqual([]);
      expect(await runSessionViewCommand(['--cwd', projectLink], {
        isTTY: true, settings: {}, env: {}, root, render,
      })).toBe(0);
      expect(observed[2]).toEqual(observed[0]);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a missing or nonexistent cwd filter without opening the view', async () => {
    const render = vi.fn(async () => undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runSessionViewCommand(['--cwd'], { isTTY: true, render })).toBe(1);
      expect(await runSessionViewCommand(['--cwd', '/a/nonexistent/robota-view-filter'], {
        isTTY: true, settings: {}, env: {}, render,
      })).toBe(1);
      expect(render).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([value]) => String(value)).join('')).not.toContain('/a/nonexistent');
    } finally {
      stderr.mockRestore();
    }
  });
});
