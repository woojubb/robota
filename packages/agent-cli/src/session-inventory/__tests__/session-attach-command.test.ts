import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess, InteractiveSession } from '@robota-sdk/agent-framework';
import { describe, expect, it, vi } from 'vitest';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { describeAttachConfirmation } from '../attach-confirmation.js';
import { runSessionAttachCommand, type ISessionAttachCommandOptions } from '../session-attach-command.js';
import {
  listSupervisedSessions,
  startSupervisedControl,
  type ISupervisedControl,
} from '../supervised-session-control.js';

import type { TServerMessage } from '@robota-sdk/agent-transport';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

function runtime(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({ maxTokens: 100, usedTokens: 0, usedPercentage: 0, remainingPercentage: 100 }),
    getSessionId: () => 'session_attach_cmd',
    getModelId: () => 'test-model',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

function output(): { stdout: () => string; stderr: () => string; restore: () => void } {
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return {
    stdout: () => out.mock.calls.map(([text]) => String(text)).join(''),
    stderr: () => err.mock.calls.map(([text]) => String(text)).join(''),
    restore: () => { out.mockRestore(); err.mockRestore(); },
  };
}

interface ITarget {
  root: string;
  session: InteractiveSession;
  restart: () => Promise<void>;
  listeners: (event: string) => number;
}

async function withTarget(prefix: string, run: (target: ITarget) => Promise<void>): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const root = join(scratch, 'supervised');
  const session = new InteractiveSession({ session: runtime() as never, cwd: '/tmp' });
  const start = (): Promise<ISupervisedControl> => startSupervisedControl(
    ID, () => undefined, root, () => session.getLocalActivityStatus(), undefined, undefined,
    () => 'Morning review', undefined, undefined, undefined, session,
  );
  let control = await start();
  try {
    await run({
      root,
      session,
      restart: async () => {
        await control.close();
        control = await start();
      },
      listeners: (event) =>
        (session as unknown as { listeners: Map<string, Set<unknown>> }).listeners.get(event)?.size ?? 0,
    });
  } finally {
    await control.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('robota session attach', () => {
  it('refuses without an interactive terminal and names the command for the user to run', async () => {
    const io = output();
    const confirm = vi.fn(async () => true);
    const render = vi.fn();
    try {
      expect(await runSessionAttachCommand([ID], { isTTY: false, confirm, render })).toBe(1);
      expect(io.stderr()).toContain(`robota session attach ${ID}`);
      expect(io.stderr()).toMatch(/interactive terminal/i);
      expect(confirm).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      io.restore();
    }
  });

  it('describes what it does, what it returns, and that only the user runs it', async () => {
    const io = output();
    try {
      expect(await runSessionAttachCommand(['--help'], { isTTY: false })).toBe(0);
      expect(io.stdout()).toMatch(/only the user\s+can run it/);
      expect(io.stdout()).toMatch(/should suggest the command instead/);
      expect(io.stdout()).toMatch(/keeps running/);
      expect(io.stdout()).toMatch(/Exits 0 after detaching, 1 when it could not attach/);
    } finally {
      io.restore();
    }
  });

  it('rejects malformed arguments before looking for the session', async () => {
    const io = output();
    try {
      for (const argv of [[], [ID, '--drive'], [ID, 'extra'], ['../escape']]) {
        expect(await runSessionAttachCommand(argv, { isTTY: true, settings: {}, env: {}, confirm: vi.fn(), render: vi.fn() })).toBe(1);
      }
      expect(io.stderr()).toMatch(/Usage: robota session attach/);
    } finally {
      io.restore();
    }
  });

  it('confirms on the attaching terminal and connects nothing when the user declines', async () => {
    await withTarget('rs-c1-', async ({ root, listeners }) => {
      const io = output();
      const confirm = vi.fn(async () => false);
      const render = vi.fn();
      try {
        expect(await runSessionAttachCommand([ID, '--observe'], { isTTY: true, settings: {}, env: {}, root, confirm, render })).toBe(1);
        expect(confirm).toHaveBeenCalledExactlyOnceWith({ id: ID, name: 'Morning review', mode: 'observe' });
        expect(render).not.toHaveBeenCalled();
        expect(listeners('text_delta')).toBe(0);
      } finally {
        io.restore();
      }
    });
  });

  it('refuses when the session restarted while the user was answering', async () => {
    await withTarget('rs-c2-', async ({ root, restart, listeners }) => {
      const io = output();
      const render = vi.fn();
      try {
        const confirm = vi.fn(async () => {
          await restart();
          return true;
        });
        expect(await runSessionAttachCommand([ID], { isTTY: true, settings: {}, env: {}, root, confirm, render })).toBe(1);
        expect(io.stderr()).toMatch(/changed/i);
        expect(render).not.toHaveBeenCalled();
        expect(listeners('text_delta')).toBe(0);
      } finally {
        io.restore();
      }
    });
  });

  it('drives the session, then detaches and leaves it running', async () => {
    await withTarget('rs-c3-', async ({ root, session, listeners }) => {
      const io = output();
      try {
        const render: ISessionAttachCommandOptions['render'] = async (options) => {
          expect(options.mode).toBe('drive');
          expect(options.driverId).toBe('attach:1');
          expect(options.sessionLabel).toBe('Morning review');
          const frames: TServerMessage[] = [];
          options.connection.subscribe((message) => frames.push(message));
          options.connection.send({ type: 'submit', prompt: 'hello' });
          await vi.waitFor(() => expect(frames.some((frame) => frame.type === 'complete')).toBe(true));
          return 'user';
        };
        expect(await runSessionAttachCommand([ID], { isTTY: true, settings: {}, env: {}, root, confirm: async () => true, render })).toBe(0);
        expect(io.stdout()).toMatch(/keeps running/i);
        expect(io.stdout()).toContain(`robota session stop ${ID}`);
        await vi.waitFor(() => expect(listeners('text_delta')).toBe(0));
        expect(session.getMessages().some((message) => message.content === 'hello')).toBe(true);
        expect(await listSupervisedSessions(root)).toEqual([
          expect.objectContaining({ id: ID, liveness: 'alive', control: 'available' }),
        ]);
      } finally {
        io.restore();
      }
    });
  });

  it('passes the screen-reader choice to the attached view', async () => {
    await withTarget('rs-c7-', async ({ root }) => {
      const io = output();
      try {
        const render = vi.fn(async () => 'user' as const);
        expect(await runSessionAttachCommand([ID, '--observe', '--screen-reader'], {
          isTTY: true, settings: {}, env: {}, root, confirm: async () => true, render,
        })).toBe(0);
        expect(render).toHaveBeenCalledWith(expect.objectContaining({ mode: 'observe', screenReader: true }));
      } finally {
        io.restore();
      }
    });
  });

  it('reports a session that closed the connection', async () => {
    await withTarget('rs-c4-', async ({ root }) => {
      const io = output();
      try {
        const render: ISessionAttachCommandOptions['render'] = async () => 'closed';
        expect(await runSessionAttachCommand([ID], { isTTY: true, settings: {}, env: {}, root, confirm: async () => true, render })).toBe(0);
        expect(io.stdout()).toMatch(/closed the connection/i);
      } finally {
        io.restore();
      }
    });
  });

  it('refuses a session that is not listed as live and controllable', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-c5-'));
    const io = output();
    const confirm = vi.fn();
    try {
      expect(await runSessionAttachCommand([ID], {
        isTTY: true, settings: {}, env: {}, root: join(scratch, 'supervised'), confirm, render: vi.fn(),
      })).toBe(1);
      expect(io.stderr()).toMatch(/not a live supervised session/i);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      io.restore();
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('is routed before the interactive shell and refuses a non-TTY caller', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rs-c6-'));
    const previousExitCode = process.exitCode;
    const io = output();
    try {
      const handled = await runPreparsedCliCommand(
        { providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd) },
        ['node', 'robota', 'session', 'attach', ID],
        cwd,
      );
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(io.stderr()).toContain(`robota session attach ${ID}`);
    } finally {
      io.restore();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('attach confirmation question', () => {
  it('names the session and the role, and cannot be repainted by the session name', () => {
    const drive = describeAttachConfirmation({ id: ID, name: 'Morning\x1b[2J review', mode: 'drive' });
    expect(drive).toContain('drive (send prompts, answer its questions)');
    expect(drive).toContain(ID);
    expect(drive).not.toContain('\x1b');
    expect(describeAttachConfirmation({ id: ID, mode: 'observe' })).toContain('observe (read only)');
  });
});
