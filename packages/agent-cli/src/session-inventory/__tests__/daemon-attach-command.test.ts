import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess, InteractiveSession } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { runDaemonAttachCommand, type IDaemonAttachCommandOptions } from '../daemon-attach-command.js';
import {
  startSupervisedControl,
  type ISupervisedControl,
  type ISupervisedSessionRow,
} from '../supervised-session-control.js';

import type { IAttachedAppPresentation } from '../../startup/attached-app-render.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const GENERATION = 'Gq3vK8mP2xR9tY5wZ1aB4c';

let scratch: string;
let workspace: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rs-dat-'));
  workspace = realpathSync(scratch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

function output(): { stdout: () => string; stderr: () => string; restore: () => void } {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return {
    stdout: () => out.mock.calls.map(([text]) => String(text)).join(''),
    stderr: () => err.mock.calls.map(([text]) => String(text)).join(''),
    restore: () => { out.mockRestore(); err.mockRestore(); },
  };
}

function daemonRow(overrides: Partial<ISupervisedSessionRow> = {}): ISupervisedSessionRow {
  return {
    id: ID, liveness: 'alive', control: 'available', activity: 'idle', cwd: workspace,
    generation: GENERATION, daemon: true, name: 'Main daemon', ...overrides,
  };
}

function listing(rows: readonly ISupervisedSessionRow[]): NonNullable<IDaemonAttachCommandOptions['list']> {
  return vi.fn(async () => rows) as unknown as NonNullable<IDaemonAttachCommandOptions['list']>;
}

function runtime(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({ maxTokens: 100, usedTokens: 0, usedPercentage: 0, remainingPercentage: 100 }),
    getSessionId: () => 'session_daemon_attach',
    getModelId: () => 'test-model',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

/** A live daemon of `workspace` on a real control socket, as `robota daemon start` leaves one. */
async function withDaemon(
  run: (daemon: { root: string; listeners: (event: string) => number }) => Promise<void>,
): Promise<void> {
  const root = join(scratch, 'supervised');
  const session = new InteractiveSession({ session: runtime() as never, cwd: workspace });
  const control: ISupervisedControl = await startSupervisedControl(
    ID, () => undefined, root, () => session.getLocalActivityStatus(), () => workspace, undefined,
    () => 'Main daemon', undefined, undefined, undefined, { session },
    { url: () => 'ws://127.0.0.1:9?token=test' },
  );
  try {
    await run({
      root,
      listeners: (event) =>
        (session as unknown as { listeners: Map<string, Set<unknown>> }).listeners.get(event)?.size ?? 0,
    });
  } finally {
    await control.close();
  }
}

describe('robota --attach', () => {
  it('refuses every option that would shape the session, naming the daemon commands', async () => {
    const io = output();
    const list = listing([daemonRow()]);
    const confirm = vi.fn(async () => true);
    const render = vi.fn(async () => 'user' as const);
    try {
      for (const argv of [
        ['--attach', '--model', 'x'],
        ['--attach', '--permission-mode', 'plan'],
        ['--resume', 'abc', '--attach'],
        ['-p', 'hello', '--attach'],
        ['--attach', '--serve'],
        ['--attach', '--fork-session'],
        ['--attach', '--safe-mode'],
      ]) {
        expect(await runDaemonAttachCommand(argv, { cwd: scratch, isTTY: true, list, confirm, render })).toBe(1);
        expect(io.stderr()).toContain(`robota --attach does not take ${argv[0] === '--attach' ? argv[1] : argv[0]}`);
      }
      expect(io.stderr()).toMatch(/shaped by the daemon/);
      expect(io.stderr()).toContain('robota daemon stop');
      expect(io.stderr()).toContain('robota daemon start');
      expect(list).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      io.restore();
    }
  });

  it('says how to start a daemon when this workspace has none', async () => {
    const io = output();
    const confirm = vi.fn(async () => true);
    const render = vi.fn(async () => 'user' as const);
    try {
      expect(await runDaemonAttachCommand(['--attach'], {
        cwd: scratch, root: join(scratch, 'supervised'), isTTY: true, confirm, render,
      })).toBe(1);
      expect(io.stderr()).toBe(`No daemon is running in ${workspace}. Start one with: robota daemon start\n`);
      // A daemon of another workspace, or one that is not live, is not this workspace's daemon.
      const others = listing([
        daemonRow({ cwd: join(workspace, 'elsewhere') }),
        daemonRow({ liveness: 'dead' }),
        { ...daemonRow(), daemon: undefined } as unknown as ISupervisedSessionRow,
      ]);
      expect(await runDaemonAttachCommand(['--attach'], { cwd: scratch, isTTY: true, list: others, confirm, render })).toBe(1);
      expect(confirm).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      io.restore();
    }
  });

  it('refuses without an interactive terminal and names the command for the user to run', async () => {
    const io = output();
    const confirm = vi.fn(async () => true);
    const render = vi.fn(async () => 'user' as const);
    try {
      expect(await runDaemonAttachCommand(['--attach'], {
        cwd: scratch, isTTY: false, list: listing([daemonRow()]), confirm, render,
      })).toBe(1);
      expect(io.stderr()).toContain('Ask the user to run: robota --attach');
      expect(io.stderr()).toMatch(/interactive terminal/);
      expect(confirm).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      io.restore();
    }
  });

  it('connects nothing when the user declines', async () => {
    const io = output();
    const confirm = vi.fn(async () => false);
    const open = vi.fn();
    const render = vi.fn(async () => 'user' as const);
    try {
      expect(await runDaemonAttachCommand(['--attach'], {
        cwd: scratch, isTTY: true, list: listing([daemonRow()]), confirm, open, render,
      })).toBe(1);
      expect(confirm).toHaveBeenCalledExactlyOnceWith({ id: ID, name: 'Main daemon', mode: 'drive' });
      expect(io.stderr()).toBe('Attach cancelled.\n');
      expect(open).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      io.restore();
    }
  });

  it('drives the daemon through the renderer, then detaches and leaves it running', async () => {
    await withDaemon(async ({ root, listeners }) => {
      const io = output();
      const confirm = vi.fn(async () => true);
      try {
        const render: IDaemonAttachCommandOptions['render'] = async (options) => {
          expect(options.driverId).toBe('attach:1');
          expect(options.sessionLabel).toBe('Main daemon');
          expect(options.screenReaderFlag).toBe(true);
          const frames: TServerMessage[] = [];
          options.connection.subscribe((message) => frames.push(message));
          options.connection.send({ type: 'get-executing' });
          await vi.waitFor(() => expect(frames).toContainEqual({ type: 'executing', executing: false }));
          expect(listeners('text_delta')).toBeGreaterThan(0);
          return 'user';
        };
        expect(await runDaemonAttachCommand(['--attach', '--screen-reader'], {
          cwd: scratch, root, isTTY: true, confirm, render,
        })).toBe(0);
        expect(confirm).toHaveBeenCalledExactlyOnceWith({ id: ID, name: 'Main daemon', mode: 'drive' });
        expect(io.stdout()).toBe(`Detached from daemon ${ID}. It keeps running; stop it with robota daemon stop.\n`);
        // Detached: the daemon's session no longer streams to this terminal.
        await vi.waitFor(() => expect(listeners('text_delta')).toBe(0));
      } finally {
        io.restore();
      }
    });
  });

  it('reports a daemon that closed the connection, and still detaches', async () => {
    const io = output();
    const detach = vi.fn();
    const open = vi.fn(async () => ({
      driverId: 'attach:1',
      send: vi.fn(),
      subscribe: () => () => undefined,
      onClose: () => () => undefined,
      detach,
    }));
    try {
      expect(await runDaemonAttachCommand(['--attach'], {
        cwd: scratch, root: join(scratch, 'supervised'), isTTY: true, list: listing([daemonRow()]),
        confirm: async () => true, open, render: async () => 'closed',
      })).toBe(0);
      expect(open).toHaveBeenCalledExactlyOnceWith(ID, 'drive', join(scratch, 'supervised'), GENERATION);
      expect(detach).toHaveBeenCalledOnce();
      expect(io.stdout()).toBe('The daemon closed the connection (it stopped, or cut this terminal off).\n');
    } finally {
      io.restore();
    }
  });

  it('describes what it does, what it returns, and that only the user runs it', async () => {
    const io = output();
    try {
      expect(await runDaemonAttachCommand(['--attach', '--help'], { cwd: scratch })).toBe(0);
      expect(io.stdout()).toMatch(/only the user\s+can run it/);
      expect(io.stdout()).toMatch(/should suggest the command instead/);
      expect(io.stdout()).toMatch(/daemon keeps running/);
      expect(io.stdout()).toMatch(/Exits 0\s+after detaching, 1 when it could not attach/);
    } finally {
      io.restore();
    }
  });
});

describe('robota --attach routing', () => {
  const previousExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = previousExitCode;
  });
  const presentation = {
    renderAttachedApp: vi.fn(),
    createThemeSurface: vi.fn(),
    createNodeKeybindingsSource: vi.fn(),
    createDefaultTuiCliAdapter: vi.fn(),
  } as unknown as IAttachedAppPresentation;
  const route = (argv: readonly string[], withPresentation = true): Promise<boolean> =>
    runPreparsedCliCommand(
      { providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', scratch) },
      ['node', 'robota', ...argv],
      scratch,
      {},
      undefined,
      undefined,
      withPresentation ? presentation : undefined,
    );

  it('is routed before the strict parser and refuses a session option', async () => {
    const io = output();
    try {
      expect(await route(['--attach', '--model', 'x'])).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(io.stderr()).toContain('robota --attach does not take --model');
    } finally {
      io.restore();
    }
  });

  it('finds no daemon under an empty home and says how to start one', async () => {
    vi.stubEnv('HOME', scratch);
    vi.stubEnv('XDG_RUNTIME_DIR', '');
    const io = output();
    try {
      expect(await route(['--attach'])).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(io.stderr()).toBe(`No daemon is running in ${workspace}. Start one with: robota daemon start\n`);
    } finally {
      io.restore();
    }
  });

  it('needs the terminal UI, which a headless runtime does not have', async () => {
    const io = output();
    try {
      expect(await route(['--attach'], false)).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(io.stderr()).toMatch(/needs the interactive CLI/);
    } finally {
      io.restore();
    }
  });

  it('leaves a subcommand that happens to carry the flag to that subcommand', async () => {
    const io = output();
    try {
      expect(await route(['session', 'stop', '--attach'])).toBe(true);
      expect(io.stderr()).toMatch(/supervised session/i);
      expect(io.stderr()).not.toContain('robota --attach');
    } finally {
      io.restore();
    }
  });
});
