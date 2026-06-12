/**
 * CLI-B11 TC-01/03/04/05: session-switch channel ownership at the App boundary.
 *
 * The 2026-05-31 context-loss bug lived between render.tsx, App.tsx and
 * TuiInteractionChannel — InteractiveSession-level tests stayed green through it.
 * These tests render the REAL App with a mocked createChannel factory and drive
 * switches through the real SessionPicker, pinning the factory-call contract.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.js';
import { CommandEffectQueue } from '../hooks/command-effect-queue.js';
import { TuiStateManager } from '../tui-state-manager.js';

import type { ICommandEffectQueue } from '../hooks/command-effect-queue.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TuiInteractionChannel } from '../TuiInteractionChannel.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-framework';

const TICK_MS = 30;
const FRAME_DEADLINE_MS = 3000;

function tick(ms = TICK_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
): Promise<void> {
  const deadline = Date.now() + FRAME_DEADLINE_MS;
  while (Date.now() < deadline) {
    const frame = lastFrame();
    if (frame !== undefined && predicate(frame)) return;
    await tick(10);
  }
  throw new Error(`waitForFrame timeout\n--- frame ---\n${lastFrame() ?? '<none>'}`);
}

interface IFakeChannel {
  sessionName: string | undefined;
  stateManager: TuiStateManager;
  onChange: (() => void) | null;
  isShuttingDown: boolean;
  permissionRequest: null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  handleInput: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  cancelQueue: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  selectExecutionWorkspaceEntry: ReturnType<typeof vi.fn>;
  readExecutionWorkspaceDetail: ReturnType<typeof vi.fn>;
  getSession: () => unknown;
  getRegistry: () => unknown;
  getCommandEffectQueue: () => ICommandEffectQueue;
  /** Test handle: the queue backing getCommandEffectQueue. */
  effectQueue: CommandEffectQueue;
  /** Test handle: which resumeSessionId this channel was created for. */
  createdFor: string | undefined;
}

function createFakeChannel(createdFor: string | undefined): IFakeChannel {
  const effectQueue = new CommandEffectQueue();
  const fakeSession = {
    getName: (): string | undefined => undefined,
    getSession: (): never => {
      throw new Error('session not initialized (test fake)');
    },
    getFullHistory: (): never[] => [],
    setName: vi.fn(),
    shutdown: vi.fn(async () => {}),
    sendAgentJob: vi.fn(async () => {}),
  };
  const fakeRegistry = {
    getCommands: (): never[] => [],
    getSubcommands: (): never[] => [],
  };
  return {
    sessionName: undefined,
    stateManager: new TuiStateManager(),
    onChange: null,
    isShuttingDown: false,
    permissionRequest: null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    handleInput: vi.fn(async () => {}),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    shutdown: vi.fn(async () => {}),
    selectExecutionWorkspaceEntry: vi.fn(),
    readExecutionWorkspaceDetail: vi.fn(async () => ({ lines: [], title: '' })),
    getSession: () => fakeSession,
    getRegistry: () => fakeRegistry,
    getCommandEffectQueue: () => effectQueue,
    effectQueue,
    createdFor,
  };
}

function asChannel(fake: IFakeChannel): TuiInteractionChannel {
  return fake as unknown as TuiInteractionChannel;
}

function createFakeStore(records: IInteractiveSessionRecord[]): IInteractiveSessionStore {
  return {
    save: () => undefined,
    load: (id) => records.find((r) => r.id === id),
    list: () => records,
    delete: () => undefined,
  };
}

function sessionRecord(
  id: string,
  cwd: string,
  updatedAt = '2026-06-13T00:00:00.000Z',
): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt,
    messages: [
      { role: 'user', content: `hello from ${id}` },
      { role: 'assistant', content: `reply in ${id}` },
    ] as IInteractiveSessionRecord['messages'],
  };
}

/** The picker lists sessions newest-first; bumping updatedAt puts a record on top. */
function touch(records: IInteractiveSessionRecord[], id: string, updatedAt: string): void {
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error(`no record ${id}`);
  record.updatedAt = updatedAt;
}

function createCliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: () => ({}),
    writeSettings: vi.fn(),
    deleteSettings: vi.fn().mockReturnValue(false),
    applyStatusLineSettings: vi.fn(),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

describe('App session-switch channel ownership (CLI-B11)', () => {
  let cwd: string;
  let created: IFakeChannel[];
  let createChannel: ReturnType<typeof vi.fn>;
  let initialChannel: IFakeChannel;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-b11-'));
    created = [];
    initialChannel = createFakeChannel(undefined);
    createChannel = vi.fn((resumeSessionId?: string) => {
      const fake = createFakeChannel(resumeSessionId);
      created.push(fake);
      return asChannel(fake);
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function renderApp(options?: { withFactory?: boolean; sessionIds?: string[] }) {
    const ids = options?.sessionIds ?? ['session-aaaaaaaa', 'session-bbbbbbbb'];
    const records = ids.map((id) => sessionRecord(id, cwd));
    const store = createFakeStore(records);
    const instance = render(
      <App
        cwd={cwd}
        channel={asChannel(initialChannel)}
        {...(options?.withFactory === false ? {} : { createChannel })}
        sessionStore={store}
        showSessionPickerOnStart
        cliAdapter={createCliAdapter(join(cwd, 'settings.json'))}
      />,
    );
    return { ...instance, records };
  }

  it('TC-01: selecting a session in the picker calls createChannel exactly once with that sessionId', async () => {
    const { stdin, lastFrame } = renderApp();
    await tick();
    expect(lastFrame()).toContain('Select a session to resume');

    stdin.write('\r'); // select first item (newest first — equal timestamps keep list order)
    await tick();

    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenCalledWith('session-aaaaaaaa');
  });

  it('TC-03: the previous channel is stopped on switch and the new channel is started', async () => {
    const { stdin } = renderApp();
    await tick();

    stdin.write('\r');
    await tick();

    // Old channel released: stopped by the switch handler and by the unmounting
    // AppInner's effect cleanup (stop() is idempotent by contract).
    expect(initialChannel.stop).toHaveBeenCalled();
    expect(created).toHaveLength(1);
    const newChannel = created[0]!;
    expect(newChannel.start).toHaveBeenCalled();
    expect(newChannel.stop).not.toHaveBeenCalled();
  });

  it('TC-04: without a createChannel prop, the switch falls back to props.channel and does not crash', async () => {
    const { stdin, lastFrame } = renderApp({ withFactory: false });
    await tick();

    stdin.write('\r');
    await tick();

    expect(createChannel).not.toHaveBeenCalled();
    // Fallback keeps the initial channel active; the app keeps rendering.
    expect(lastFrame()).toBeTruthy();
    expect(initialChannel.start).toHaveBeenCalled();
  });

  it('TC-05: consecutive switches A→B→C create one channel per switch and stop each prior channel', async () => {
    // Selection always takes the top (newest) entry; arrow-key navigation itself
    // is covered by ListPicker.test.tsx. updatedAt ordering decides the target.
    const ids = ['aaaaaaaa-1111', 'bbbbbbbb-2222', 'cccccccc-3333'];
    const { stdin, lastFrame, records } = renderApp({ sessionIds: ids });
    touch(records, 'aaaaaaaa-1111', '2026-06-13T01:00:00.000Z'); // A on top
    await waitForFrame(lastFrame, (f) => f.includes('Select a session to resume'));

    // Switch 1: pick A (top) from the startup picker.
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 1);
    expect(createChannel).toHaveBeenNthCalledWith(1, 'aaaaaaaa-1111');
    const channelA = created[0]!;

    // Switch 2: reopen the picker via a queued session-picker-requested effect,
    // drained by a submit on the active channel (real /resume drain path).
    touch(records, 'bbbbbbbb-2222', '2026-06-13T02:00:00.000Z'); // B on top
    channelA.effectQueue.enqueueEffects([{ type: 'session-picker-requested' }]);
    stdin.write('x');
    await tick();
    stdin.write('\r'); // submit input → drains queue → picker opens
    await waitForFrame(lastFrame, (f) => f.includes('> bbbbbbbb'));
    await tick(); // settle: let the reopened picker's useInput subscription attach
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);
    expect(createChannel).toHaveBeenNthCalledWith(2, 'bbbbbbbb-2222');
    expect(channelA.stop).toHaveBeenCalled();
    const channelB = created[1]!;
    expect(channelB.start).toHaveBeenCalled();

    // Switch 3: same drill from B to C.
    touch(records, 'cccccccc-3333', '2026-06-13T03:00:00.000Z'); // C on top
    channelB.effectQueue.enqueueEffects([{ type: 'session-picker-requested' }]);
    stdin.write('x');
    await tick();
    stdin.write('\r');
    await waitForFrame(lastFrame, (f) => f.includes('> cccccccc'));
    await tick(); // settle: let the reopened picker's useInput subscription attach
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 3);
    expect(createChannel).toHaveBeenNthCalledWith(3, 'cccccccc-3333');
    expect(channelB.stop).toHaveBeenCalled();

    const channelC = created[2]!;
    expect(channelC.start).toHaveBeenCalled();
    expect(channelC.stop).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(3);
  });
});
