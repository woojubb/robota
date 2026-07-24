/**
 * CLI-B11 TC-01/03/05 + CLI-B12 TC-01/02/04: session-switch channel ownership
 * at the App boundary.
 *
 * The 2026-05-31 context-loss bug lived between render.tsx, App.tsx and
 * TuiInteractionChannel — InteractiveSession-level tests stayed green through it.
 * These tests render the REAL App with a mocked createChannel factory and drive
 * switches through the real SessionPicker, pinning the factory-call contract.
 * Since CLI-B12 the factory is the SOLE channel source: App creates the initial
 * channel in its useState initializer and replaces it on every switch.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.js';
import { TuiStateManager } from '../tui-state-manager.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TuiInteractionChannel } from '../TuiInteractionChannel.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-transport';

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
  pendingUserAction: null;
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
  /** Test handle: emit a session event to this channel's subscribers (CMD-004 `ui_intent` path). */
  emitSessionEvent: (event: string, payload: unknown) => void;
  /** Test handle: which resumeSessionId this channel was created for. */
  createdFor: string | undefined;
}

function createFakeChannel(createdFor: string | undefined): IFakeChannel {
  // CMD-004 Stage C: App subscribes to `ui_intent`/`session_renamed` on the session.
  const sessionListeners = new Map<string, Set<(payload: unknown) => void>>();
  const fakeSession = {
    getName: (): string | undefined => undefined,
    getSession: (): never => {
      throw new Error('session not initialized (test fake)');
    },
    getFullHistory: (): never[] => [],
    setName: vi.fn(),
    shutdown: vi.fn(async () => {}),
    sendAgentJob: vi.fn(async () => {}),
    on: (event: string, handler: (payload: unknown) => void): void => {
      const set = sessionListeners.get(event) ?? new Set<(payload: unknown) => void>();
      set.add(handler);
      sessionListeners.set(event, set);
    },
    off: (event: string, handler: (payload: unknown) => void): void => {
      sessionListeners.get(event)?.delete(handler);
    },
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
    pendingUserAction: null,
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
    emitSessionEvent: (event, payload) => {
      for (const handler of [...(sessionListeners.get(event) ?? [])]) handler(payload);
    },
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

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-b11-'));
    created = [];
    createChannel = vi.fn((resumeSessionId?: string) => {
      const fake = createFakeChannel(resumeSessionId);
      created.push(fake);
      return asChannel(fake);
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function renderApp(options?: { sessionIds?: string[] }) {
    const ids = options?.sessionIds ?? ['session-aaaaaaaa', 'session-bbbbbbbb'];
    const records = ids.map((id) => sessionRecord(id, cwd));
    const store = createFakeStore(records);
    const instance = render(
      <App
        cwd={cwd}
        createChannel={createChannel}
        sessionStore={store}
        showSessionPickerOnStart
        cliAdapter={createCliAdapter(join(cwd, 'settings.json'))}
      />,
    );
    return { ...instance, records };
  }

  it('TC-01 (B11) / TC-01 (B12): the factory is the sole channel source — once at mount, once per switch with the selected sessionId', async () => {
    const { stdin, lastFrame } = renderApp();
    await tick();
    expect(lastFrame()).toContain('Select a session to resume');

    // CLI-B12 TC-01: initial channel from the useState initializer, exactly once.
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenNthCalledWith(1, undefined);

    stdin.write('\r'); // select first item (newest first — equal timestamps keep list order)
    await tick();

    // CLI-B11 TC-A: the switch asks the factory for exactly one channel with the id.
    expect(createChannel).toHaveBeenCalledTimes(2);
    expect(createChannel).toHaveBeenNthCalledWith(2, 'session-aaaaaaaa');
  });

  it('TC-03 (B11) / TC-02 (B12): the previous channel is stopped before the new one becomes active', async () => {
    const { stdin } = renderApp();
    await tick();
    const initialChannel = created[0]!;
    expect(initialChannel.start).toHaveBeenCalled();

    stdin.write('\r');
    await tick();

    // Old channel released: stopped by the switch handler and by the unmounting
    // AppInner's effect cleanup (stop() is idempotent by contract).
    expect(initialChannel.stop).toHaveBeenCalled();
    expect(created).toHaveLength(2);
    const newChannel = created[1]!;
    expect(newChannel.start).toHaveBeenCalled();
    expect(newChannel.stop).not.toHaveBeenCalled();

    // CLI-B12 TC-02 ordering: old stop() was invoked BEFORE the factory built
    // the replacement channel (stop-before-active contract).
    const stopOrder = initialChannel.stop.mock.invocationCallOrder[0]!;
    const replacementOrder = createChannel.mock.invocationCallOrder[1]!;
    expect(stopOrder).toBeLessThan(replacementOrder);
  });

  it('TC-04 (B12): App renders from the factory alone — no channel prop exists', async () => {
    // The old no-factory fallback (B11 TC-D) is deleted with CLI-B12: createChannel
    // is required and `channel` is no longer a prop (enforced at the type level —
    // passing one is a compile error). This pins the runtime half: a render with
    // only the factory boots, starts the initial channel, and keeps rendering.
    const { lastFrame } = renderApp();
    await tick();

    expect(lastFrame()).toBeTruthy();
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(created[0]!.start).toHaveBeenCalled();
  });

  it('TC-05: consecutive switches A→B→C create one channel per switch and stop each prior channel', async () => {
    // Selection always takes the top (newest) entry; arrow-key navigation itself
    // is covered by ListPicker.test.tsx. updatedAt ordering decides the target.
    const ids = ['aaaaaaaa-1111', 'bbbbbbbb-2222', 'cccccccc-3333'];
    const { stdin, lastFrame, records } = renderApp({ sessionIds: ids });
    touch(records, 'aaaaaaaa-1111', '2026-06-13T01:00:00.000Z'); // A on top
    await waitForFrame(lastFrame, (f) => f.includes('Select a session to resume'));

    // Mount creates the initial channel (factory call 1, undefined).
    expect(createChannel).toHaveBeenNthCalledWith(1, undefined);
    const channelInitial = created[0]!;

    // Switch 1: pick A (top) from the startup picker.
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);
    expect(createChannel).toHaveBeenNthCalledWith(2, 'aaaaaaaa-1111');
    expect(channelInitial.stop).toHaveBeenCalled();
    const channelA = created[1]!;

    // Switch 2: reopen the picker via the requester-routed ui_intent (real /resume path since
    // CMD-004 Stage C: the session emits `ui_intent` and the owner surface renders it).
    touch(records, 'bbbbbbbb-2222', '2026-06-13T02:00:00.000Z'); // B on top
    channelA.emitSessionEvent('ui_intent', {
      intent: { type: 'show-session-picker' },
      requesterDriverId: 'owner',
    });
    await waitForFrame(lastFrame, (f) => f.includes('> bbbbbbbb'));
    await tick(); // settle: let the reopened picker's useInput subscription attach
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 3);
    expect(createChannel).toHaveBeenNthCalledWith(3, 'bbbbbbbb-2222');
    expect(channelA.stop).toHaveBeenCalled();
    const channelB = created[2]!;
    expect(channelB.start).toHaveBeenCalled();

    // Switch 3: same drill from B to C.
    touch(records, 'cccccccc-3333', '2026-06-13T03:00:00.000Z'); // C on top
    channelB.emitSessionEvent('ui_intent', {
      intent: { type: 'show-session-picker' },
      requesterDriverId: 'owner',
    });
    await waitForFrame(lastFrame, (f) => f.includes('> cccccccc'));
    await tick(); // settle: let the reopened picker's useInput subscription attach
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 4);
    expect(createChannel).toHaveBeenNthCalledWith(4, 'cccccccc-3333');
    expect(channelB.stop).toHaveBeenCalled();

    const channelC = created[3]!;
    expect(channelC.start).toHaveBeenCalled();
    expect(channelC.stop).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(4);
  });
});
