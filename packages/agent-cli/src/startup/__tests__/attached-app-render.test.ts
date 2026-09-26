/**
 * `robota --attach` end to end in process: the real renderer, with the presentation the CLI
 * resolves, on an attach connection the daemon then closes. The command reports the close, detaches
 * and exits 0.
 *
 * Ink needs a terminal to read keys from; the test process has none, so standard input claims to be
 * one and raw mode is a no-op. Nothing is typed: the daemon ends the app.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import {
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
  renderAttachedApp,
} from '@robota-sdk/agent-ui-terminal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runDaemonAttachCommand } from '../../session-inventory/daemon-attach-command.js';
import { createAttachedAppRender } from '../attached-app-render.js';
import { createThemeSurface } from '../theme-surface.js';

import type { TClientMessage } from '@robota-sdk/agent-transport';
import type { ISupervisedAttachConnection } from '../../session-inventory/supervised-attach-client.js';
import type { ISupervisedSessionRow } from '../../session-inventory/supervised-session-control.js';

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
const GENERATION = 'Gq3vK8mP2xR9tY5wZ1aB4c';

let scratch: string;
let restoreStdin: () => void = () => undefined;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rs-aar-')));
  // Settings, keybindings, themes and prompt history are all read from this home, not the real one.
  vi.stubEnv('HOME', scratch);
  const stdin = process.stdin as NodeJS.ReadStream;
  const tty = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
  const rawMode = Object.getOwnPropertyDescriptor(stdin, 'setRawMode');
  Object.defineProperty(stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(stdin, 'setRawMode', { value: () => stdin, configurable: true, writable: true });
  restoreStdin = () => {
    if (tty === undefined) delete (stdin as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(stdin, 'isTTY', tty);
    if (rawMode === undefined) delete (stdin as { setRawMode?: unknown }).setRawMode;
    else Object.defineProperty(stdin, 'setRawMode', rawMode);
  };
});

afterEach(() => {
  restoreStdin();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/** Swallow terminal output, but complete each write: Ink waits for its last frame to flush. */
function captureWrites(stream: NodeJS.WriteStream): { readonly text: () => string } {
  const spy = vi.spyOn(stream, 'write').mockImplementation(((
    _chunk: unknown,
    encodingOrDone?: unknown,
    done?: unknown,
  ) => {
    const callback = typeof encodingOrDone === 'function' ? encodingOrDone : done;
    if (typeof callback === 'function') queueMicrotask(() => callback());
    return true;
  }) as typeof stream.write);
  return { text: () => spy.mock.calls.map(([chunk]) => String(chunk)).join('') };
}

function closingConnection(): {
  readonly connection: ISupervisedAttachConnection;
  readonly sent: TClientMessage[];
  readonly close: () => void;
} {
  const sent: TClientMessage[] = [];
  const closeListeners = new Set<() => void>();
  return {
    sent,
    close: () => {
      for (const listener of [...closeListeners]) listener();
    },
    connection: {
      driverId: 'attach:1',
      send: (message) => { sent.push(message); },
      subscribe: () => () => undefined,
      onClose: (listener) => {
        closeListeners.add(listener);
        return () => { closeListeners.delete(listener); };
      },
      detach: vi.fn(),
    },
  };
}

describe('robota --attach with the real renderer', () => {
  it('renders the attached TUI, and reports the daemon closing the connection with exit 0', async () => {
    const stdout = captureWrites(process.stdout);
    captureWrites(process.stderr);
    const daemon = closingConnection();
    const row: ISupervisedSessionRow = {
      id: ID, liveness: 'alive', control: 'available', activity: 'idle', cwd: scratch,
      generation: GENERATION, daemon: true, name: 'Main daemon',
    };
    const run = runDaemonAttachCommand(['--attach'], {
      cwd: scratch,
      root: join(scratch, 'supervised'),
      isTTY: true,
      list: (async () => [row]) as never,
      confirm: async () => true,
      open: async () => daemon.connection,
      render: createAttachedAppRender(
        { renderAttachedApp, createThemeSurface, createNodeKeybindingsSource, createDefaultTuiCliAdapter },
        {
          cwd: scratch,
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', scratch),
          providerDefinitions: [],
        },
      ),
    });
    // The app is up once it asks the daemon for the conversation it attached to.
    await vi.waitFor(() => expect(daemon.sent).toContainEqual({ type: 'get-history' }), { timeout: 10_000 });
    daemon.close();
    expect(await run).toBe(0);
    expect(daemon.connection.detach).toHaveBeenCalledOnce();
    // The full TUI rendered, labelled with the daemon's session.
    expect(stdout.text()).toContain('Main daemon');
    expect(stdout.text()).toContain(
      'The daemon closed the connection (it stopped, or cut this terminal off).\n',
    );
  }, 20_000);
});
