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
import type { ITuiAppChannelPort } from '../tui-app-channel-port.js';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

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

function createFakeChannel(createdFor: string | undefined): IFakeChannel & ITuiAppChannelPort {
  // CMD-004 Stage C: App subscribes to `ui_intent`/`session_renamed` on the session.
  const sessionListeners = new Map<string, Set<(payload: unknown) => void>>();
  const fakeSession = {
    // ARCH-012: required. `useTuiChannel` reads the co-drive queue length live from the session; the
    // `?.() ?? …` that tolerated its absence was a branch nothing could take once the member became
    // required, and a wrong count if it ever did.
    getPendingCount: (): number => 0,
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
  const manager = new TuiStateManager();
  let onChange: (() => void) | null = null;
  const fake: IFakeChannel & ITuiAppChannelPort = {
    terminalHandoffController: undefined,
    sessionName: undefined,
    stateManager: manager,
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
    readExecutionWorkspaceDetail: vi.fn(async (entryId: string) => ({ entryId, records: [] })),
    getSession: () => fakeSession,
    getRegistry: () => fakeRegistry,
    subscribe: (handler) => {
      onChange = handler;
      fake.onChange = handler;
      return () => {
        if (onChange === handler) onChange = null;
        if (fake.onChange === handler) fake.onChange = null;
      };
    },
    getSnapshot: () => ({
      history: manager.history,
      streamingText: manager.streamingText,
      activeTools: manager.activeTools,
      isThinking: manager.isThinking,
      isAborting: manager.isAborting,
      lastErrorMessage: manager.lastErrorMessage,
      isStalled: manager.isStalled,
      sessionEventNotices: manager.sessionEventNotices,
      isShuttingDown: false,
      pendingPrompt: manager.pendingPrompt,
      pendingCount: 0,
      executionWorkspaceSnapshot: manager.executionWorkspaceSnapshot,
      permissionRequest: null,
      pendingUserAction: null,
      contextState: manager.contextState,
    }),
    getSessionUiEventPort: () => fakeSession,
    getCommandQueryPort: () => fakeRegistry,
    getRuntimeStatusSnapshot: (permissionMode) => ({ permissionMode, sessionId: '' }),
    addEntry: (entry) => manager.addEntry(entry),
    sendAgentJob: vi.fn(async () => {}),
    resolveUserAction: vi.fn(),
    emitSessionEvent: (event, payload) => {
      for (const handler of [...(sessionListeners.get(event) ?? [])]) handler(payload);
    },
    createdFor,
  };
  return fake;
}

function createFakeStore(records: IInteractiveSessionRecord[]): IInteractiveSessionStore {
  return {
    save: () => undefined,
    load: (id) => {
      const record = records.find((r) => r.id === id);
      return record === undefined ? { status: 'missing' } : { status: 'valid', record };
    },
    list: () => records.map((record) => ({ id: record.id, outcome: { status: 'valid', record } })),
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
  let initialStartError: Error | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-b11-'));
    created = [];
    initialStartError = undefined;
    createChannel = vi.fn((resumeSessionId?: string) => {
      const fake = createFakeChannel(resumeSessionId);
      if (created.length === 0 && initialStartError !== undefined) {
        fake.start.mockRejectedValueOnce(initialStartError);
      }
      created.push(fake);
      return fake;
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

    // Old channel released by the switch handler; final App teardown belongs to renderApp's
    // awaitable composition boundary.
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

  it('TC-02 (REFACTOR-025): waits for the prior stop to finish before constructing the replacement', async () => {
    const { stdin, lastFrame } = renderApp();
    await tick();
    const initialChannel = created[0]!;
    let releaseStop: (() => void) | undefined;
    initialChannel.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStop = resolve)),
    );

    stdin.write('\r');
    await tick();
    expect(initialChannel.stop).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(lastFrame()).not.toContain('Select a session to resume');

    releaseStop?.();
    await waitForFrame(
      () => '',
      () => createChannel.mock.calls.length === 2,
    );
    expect(createChannel).toHaveBeenNthCalledWith(2, 'session-aaaaaaaa');
  });

  it('does not construct a replacement after App unmounts during an in-flight switch', async () => {
    const { stdin, unmount } = renderApp();
    await tick();
    let releaseStop: (() => void) | undefined;
    created[0]!.stop.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseStop = resolve)),
    );

    stdin.write('\r');
    await tick();
    unmount();
    releaseStop?.();
    await tick();

    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it('TC-02 (REFACTOR-025): keeps the old channel selected and renders a stop failure', async () => {
    const { stdin, lastFrame } = renderApp();
    await tick();
    created[0]!.stop.mockRejectedValueOnce(new Error('transport stop failed'));

    stdin.write('\r');
    await waitForFrame(lastFrame, (frame) =>
      frame.includes('Session switch failed: transport stop failed'),
    );

    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain('Press Enter to retry.');

    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);
    // One failed switch and one successful retry.
    expect(created[0]!.stop).toHaveBeenCalledTimes(2);
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

  it('REFACTOR-025: renders a start failure, blocks normal input, and retries on Enter', async () => {
    initialStartError = new Error('transport start failed');
    const { stdin, lastFrame } = renderApp();
    await waitForFrame(lastFrame, (frame) =>
      frame.includes('TUI start failed: transport start failed'),
    );
    expect(lastFrame()).toContain('Press Enter to retry.');

    stdin.write('\r');
    await waitForFrame(lastFrame, () => created[0]!.start.mock.calls.length === 2);
    await tick();
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(lastFrame()).toContain('Select a session to resume');
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
    await tick(); // allow the replacement view's session-event subscription to attach

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
    await tick(); // allow the replacement view's session-event subscription to attach

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
