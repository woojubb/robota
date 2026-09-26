import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { renderSupervisedSessionView } from '@robota-sdk/agent-ui-terminal';

import { runSessionViewCommand } from '../session-view-command.js';
import {
  linkSupervisedPr,
  listSupervisedSessions,
  startSupervisedControl,
} from '../supervised-session-control.js';

function readGeneration(root: string, id: string): string {
  return String((JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')) as { generation?: unknown }).generation);
}

describe('session view command', () => {
  it('filters owner-linked PRs and refuses to open a stale association', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-vpr-'));
    const root = join(scratch, 'supervised');
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    let pr: ReturnType<typeof import('../supervised-session-control.js').parseSupervisedPr>;
    const control = await startSupervisedControl(
      id,
      () => undefined,
      root,
      () => 'idle',
      undefined,
      undefined,
      undefined,
      undefined,
      {
        get: () => pr,
        set: (value) => {
          pr = value;
        },
      },
    );
    const openUrl = vi.fn(async () => undefined);
    const first = 'https://github.com/team/repo/pull/123';
    const next = 'https://github.com/team/repo/pull/124';
    try {
      await linkSupervisedPr(id, first, root);
      const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
        const generation = readGeneration(root, id);
        expect(await options.loadRows(new AbortController().signal)).toEqual([
          {
            id,
            liveness: 'alive',
            control: 'available',
            activity: 'idle',
            generation,
            pr: { url: first, host: 'github.com', number: 123, kind: 'pull' },
          },
        ]);
        await linkSupervisedPr(id, next, root);
        await expect(options.onOpenPr?.(id, first, generation)).rejects.toThrow(/changed|stale/i);
        expect(openUrl).not.toHaveBeenCalled();
        await expect(options.onOpenPr?.(id, next, 'G'.repeat(22))).rejects.toThrow(/changed/i);
        expect(openUrl).not.toHaveBeenCalled();
        await options.onOpenPr?.(id, next, generation);
        expect(openUrl).toHaveBeenCalledExactlyOnceWith(next);
      });
      expect(
        await runSessionViewCommand(['--pr', '123'], {
          isTTY: true,
          settings: {},
          env: {},
          root,
          render,
          openUrl,
        }),
      ).toBe(0);
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ filteredByPr: true }));
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
  it('passes the verified global supervised inventory to its presentation without session content', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-view-'));
    const root = join(scratch, 'supervised');
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    const control = await startSupervisedControl(
      id,
      () => undefined,
      root,
      () => 'working',
    );
    let observed: unknown;
    try {
      const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
        observed = await options.loadRows(new AbortController().signal);
      });
      expect(
        await runSessionViewCommand([], {
          isTTY: true,
          settings: {},
          env: {},
          root,
          render,
        }),
      ).toBe(0);
      expect(observed).toEqual([
        { id, liveness: 'alive', control: 'available', activity: 'working', generation: readGeneration(root, id) },
      ]);
      expect(JSON.stringify(observed)).not.toMatch(/prompt|token|transcript|cwd/i);
      expect(await listSupervisedSessions(root, undefined, { includeGeneration: true })).toEqual(observed);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses without a supplied renderer instead of loading the terminal UI itself', async () => {
    const errors: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    try {
      expect(await runSessionViewCommand([], { isTTY: true, settings: {}, env: {} })).toBe(1);
      expect(errors.join('')).toMatch(/interactive CLI/);
    } finally {
      write.mockRestore();
    }
  });

  it('honors settings, environment, and flag precedence before rendering', async () => {
    const render = vi.fn(async () => undefined);
    expect(
      await runSessionViewCommand(['--screen-reader'], {
        isTTY: true,
        settings: { screenReader: true },
        env: { ROBOTA_SCREEN_READER: '0' },
        render,
      }),
    ).toBe(0);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        screenReader: true,
        screenReaderChannel: 'flag',
      }),
    );
    render.mockClear();
    expect(
      await runSessionViewCommand(['--no-screen-reader'], {
        isTTY: true,
        settings: { screenReader: true },
        env: { ROBOTA_SCREEN_READER: '1' },
        render,
      }),
    ).toBe(0);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ screenReader: false }));
  });

  it('passes only supported observed state filters to the view', async () => {
    const render = vi.fn(async () => undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(
        await runSessionViewCommand(['--state', 'idle'], {
          isTTY: true,
          settings: {},
          env: {},
          render,
        }),
      ).toBe(0);
      expect(render).toHaveBeenCalledWith(expect.objectContaining({ stateFilter: 'idle' }));
      render.mockClear();
      expect(
        await runSessionViewCommand(['--cwd', '.', '--state', 'working', '--screen-reader'], {
          isTTY: true,
          settings: {},
          env: {},
          render,
        }),
      ).toBe(0);
      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          stateFilter: 'working',
          filteredByCwd: true,
          screenReader: true,
        }),
      );
      render.mockClear();
      expect(
        await runSessionViewCommand(['--state', 'completed'], {
          isTTY: true,
          settings: {},
          env: {},
          render,
        }),
      ).toBe(1);
      expect(render).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it('filters by a live owner-reported name without displaying the query', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-vn-'));
    const root = join(scratch, 'supervised');
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    const control = await startSupervisedControl(
      id,
      () => undefined,
      root,
      () => 'idle',
      undefined,
      undefined,
      () => 'Morning review',
    );
    const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
      expect(options.filteredByName).toBe(true);
      expect(await options.loadRows(new AbortController().signal)).toEqual([
        {
          id,
          liveness: 'alive',
          control: 'available',
          activity: 'idle',
          generation: readGeneration(root, id),
          name: 'Morning review',
        },
      ]);
    });
    try {
      expect(
        await runSessionViewCommand(['--name', 'REVIEW'], {
          isTTY: true,
          settings: {},
          env: {},
          root,
          render,
        }),
      ).toBe(0);
    } finally {
      await control.close();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('does not start an interactive renderer when input or output is not a TTY', async () => {
    const render = vi.fn(async () => undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runSessionViewCommand([], { isTTY: false, render })).toBe(1);
      expect(render).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([value]) => String(value)).join('')).toMatch(
        /TTY.*session list/i,
      );
    } finally {
      stderr.mockRestore();
    }
  });

  it('passes selected stop requests to the guarded owner-control operation', async () => {
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    const stop = vi.fn(async () => undefined);
    const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
      expect(options).toHaveProperty('onStop');
      await options.onStop?.(id, 'G'.repeat(22));
    });
    expect(
      await runSessionViewCommand([], {
        isTTY: true,
        settings: {},
        env: {},
        root: '/tmp/supervised-view-test',
        render,
        stop,
      }),
    ).toBe(0);
    expect(stop).toHaveBeenCalledExactlyOnceWith(id, '/tmp/supervised-view-test', 'G'.repeat(22));
  });

  it('starts in the selected directory while keeping the view alive', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-view-start-'));
    const project = join(scratch, 'project');
    mkdirSync(project);
    const start = vi.fn(async () => '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4');
    const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
      expect(await options.onStart?.()).toBe('8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4');
    });
    try {
      expect(
        await runSessionViewCommand(['--cwd', project], {
          isTTY: true,
          settings: {},
          env: {},
          render,
          start,
        }),
      ).toBe(0);
      expect(start).toHaveBeenCalledExactlyOnceWith(realpathSync(project));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
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
    const control = await startSupervisedControl(
      id,
      () => undefined,
      root,
      undefined,
      () => realpathSync(project),
    );
    const observed: unknown[] = [];
    const render = vi.fn(async (options: Parameters<typeof renderSupervisedSessionView>[0]) => {
      expect(options.filteredByCwd).toBe(true);
      observed.push(await options.loadRows(new AbortController().signal));
    });
    try {
      expect(
        await runSessionViewCommand(['--screen-reader', '--cwd', project], {
          isTTY: true,
          settings: {},
          env: {},
          root,
          render,
        }),
      ).toBe(0);
      expect(observed[0]).toEqual([
        {
          id,
          liveness: 'alive',
          control: 'available',
          activity: 'unknown',
          generation: readGeneration(root, id),
          cwd: realpathSync(project),
        },
      ]);
      expect(
        await runSessionViewCommand(['--cwd', other, '--no-screen-reader'], {
          isTTY: true,
          settings: {},
          env: {},
          root,
          render,
        }),
      ).toBe(0);
      expect(observed[1]).toEqual([]);
      expect(
        await runSessionViewCommand(['--cwd', projectLink], {
          isTTY: true,
          settings: {},
          env: {},
          root,
          render,
        }),
      ).toBe(0);
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
      expect(
        await runSessionViewCommand(['--cwd', '/a/nonexistent/robota-view-filter'], {
          isTTY: true,
          settings: {},
          env: {},
          render,
        }),
      ).toBe(1);
      expect(render).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([value]) => String(value)).join('')).not.toContain(
        '/a/nonexistent',
      );
    } finally {
      stderr.mockRestore();
    }
  });
});
