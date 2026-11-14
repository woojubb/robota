/**
 * Session-switch channel ownership at the App boundary.
 *
 * The 2026-05-31 context-loss bug lived between render.tsx, App.tsx and
 * TuiInteractionChannel — InteractiveSession-level tests stayed green through it.
 * These tests render the REAL App with a mocked createChannel factory and drive
 * switches through the real SessionPicker, pinning the factory-call contract.
 * The factory is the SOLE channel source: App creates the initial
 * channel in its useState initializer and replaces it on every switch.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework/node';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';
import { TuiStateManager } from '../tui-state-manager.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { ITuiAppChannelPort } from '../tui-app-channel-port.js';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface/execution';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface/session';

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

async function waitForSessionPicker(lastFrame: () => string | undefined): Promise<void> {
  await waitForFrame(lastFrame, (frame) => frame.includes('Select a session to resume'));
  await tick();
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
  /** Test handle: emit a session event to this channel's subscribers (`ui_intent` path). */
  emitSessionEvent: (event: string, payload: unknown) => void;
  /** Test handle: which resumeSessionId this channel was created for. */
  createdFor: string | undefined;
}

function createFakeChannel(createdFor: string | undefined): IFakeChannel & ITuiAppChannelPort {
  // App subscribes to `ui_intent`/`session_renamed` on the session.
  const sessionListeners = new Map<string, Set<(payload: unknown) => void>>();
  const fakeSession = {
    // Required. `useTuiChannel` reads the co-drive queue length live from the session; the
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
    stopWaitingSelfPacedLoop: vi.fn(async () => {}),
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
      ...(manager.selectedExecutionEntryId === undefined
        ? {}
        : { selectedExecutionEntryId: manager.selectedExecutionEntryId }),
      permissionRequest: null,
      pendingUserAction: null,
      contextState: manager.contextState,
    }),
    getSessionUiEventPort: () => fakeSession,
    getCommandQueryPort: () => fakeRegistry,
    getRuntimeStatusSnapshot: (permissionMode) => ({ permissionMode, sessionId: '' }),
    addEntry: (entry) => {
      manager.addEntry(entry);
      onChange?.();
    },
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
  const store: Omit<IInteractiveSessionStore, 'claim' | 'lend' | 'hasWriter'> = {
    save: () => undefined,
    load: (id) => {
      const record = records.find((r) => r.id === id);
      return record === undefined ? { status: 'missing' } : { status: 'valid', record };
    },
    list: () => records.map((record) => ({ id: record.id, outcome: { status: 'valid', record } })),
    delete: () => undefined,
  };
  return withHoldReadClaim(store);
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

describe('App session-switch channel ownership', () => {
  let cwd: string;
  let created: IFakeChannel[];
  let createChannel: ReturnType<typeof vi.fn>;
  let initialStartError: Error | undefined;
  let initialStartIntent: boolean;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'agent-b11-'));
    created = [];
    initialStartError = undefined;
    initialStartIntent = false;
    createChannel = vi.fn((resumeSessionId?: string) => {
      const fake = createFakeChannel(resumeSessionId);
      if (created.length === 0 && initialStartError !== undefined) {
        fake.start.mockRejectedValueOnce(initialStartError);
      } else if (created.length === 0 && initialStartIntent) {
        fake.start.mockImplementationOnce(async () => {
          fake.emitSessionEvent('ui_intent', {
            intent: { type: 'show-session-picker' },
            requesterDriverId: 'owner',
          });
        });
      }
      created.push(fake);
      return fake;
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function renderApp(options?: { sessionIds?: string[]; showSessionPickerOnStart?: boolean }) {
    const ids = options?.sessionIds ?? ['session-aaaaaaaa', 'session-bbbbbbbb'];
    const records = ids.map((id) => sessionRecord(id, cwd));
    const store = createFakeStore(records);
    const instance = render(
      <App
        cwd={cwd}
        createChannel={createChannel}
        sessionStore={store}
        showSessionPickerOnStart={options?.showSessionPickerOnStart ?? true}
        cliAdapter={createCliAdapter(join(cwd, 'settings.json'))}
      />,
    );
    return { ...instance, records };
  }

  it('asks before continuing a fork when another job is running', async () => {
    const forkId = 'session-aaaaaaaa';
    const { stdin, lastFrame, unmount } = renderApp({ showSessionPickerOnStart: false });
    await tick();
    const initial = created[0]!;
    const base = {
      kind: 'background_task' as const,
      taskKind: 'agent' as const,
      origin: { kind: 'slash_command' as const, sessionId: 'parent' },
      state: 'working' as const,
      subtitle: 'general-purpose',
      unread: false,
      attention: 'none' as const,
      visibility: 'default' as const,
      updatedAt: '2026-11-05T00:00:00.000Z',
    };
    initial.stateManager.executionWorkspaceSnapshot = {
      sessionId: 'parent',
      selectedEntryId: 'task:fork',
      updatedAt: base.updatedAt,
      entries: [
        {
          ...base,
          id: 'task:fork',
          sourceId: 'fork',
          title: 'fork',
          status: 'completed',
          controls: ['select', 'attach'],
          resumeSessionId: forkId,
        },
        {
          ...base,
          id: 'task:other',
          sourceId: 'other',
          title: 'other',
          status: 'running',
          controls: ['select', 'cancel'],
        },
      ],
    };
    initial.onChange?.();
    await tick();
    stdin.write('\x02');
    await waitForFrame(lastFrame, (frame) => frame.includes('Execution workspace'));
    stdin.write('a');
    await waitForFrame(lastFrame, (frame) => frame.includes('1 background job is still running'));
    stdin.write('\x02');
    await tick();
    expect(lastFrame()).not.toContain('Execution workspace');
    stdin.write('\r'); // Default is No.
    await tick();
    expect(initial.stop).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);

    stdin.write('\x02');
    await waitForFrame(lastFrame, (frame) => frame.includes('Execution workspace'));
    stdin.write('a');
    await waitForFrame(lastFrame, (frame) => frame.includes('1 background job is still running'));
    stdin.write('y');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);
    expect(initial.stop).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenLastCalledWith(forkId);
    unmount();
  });

  it('reads earlier fork output from the actual background view on the user key', async () => {
    const { stdin, lastFrame, unmount } = renderApp({ showSessionPickerOnStart: false });
    await tick();
    const initial = created[0]!;
    initial.readExecutionWorkspaceDetail.mockImplementation(async (_id, cursor) => ({
      entryId: 'task:fork',
      records: cursor ? [{ id: 'earlier', kind: 'message', text: 'earlier fork output' }] : [],
    }));
    initial.stateManager.executionWorkspaceSnapshot = {
      sessionId: 'parent',
      selectedEntryId: 'task:fork',
      updatedAt: '2026-11-05T00:00:00.000Z',
      entries: [
        {
          id: 'task:fork',
          sourceId: 'fork',
          kind: 'background_task',
          taskKind: 'agent',
          origin: { kind: 'slash_command', sessionId: 'parent' },
          status: 'running',
          state: 'working',
          title: 'fork',
          unread: false,
          attention: 'none',
          visibility: 'default',
          updatedAt: '2026-11-05T00:00:00.000Z',
          controls: ['select', 'send', 'attach'],
          resumeSessionId: 'session-aaaaaaaa',
        },
      ],
    };
    initial.stateManager.selectedExecutionEntryId = 'task:fork';
    initial.onChange?.();
    await waitForFrame(lastFrame, (frame) => frame.includes('Earlier output'));
    await vi.waitFor(() =>
      expect(initial.readExecutionWorkspaceDetail).toHaveBeenCalledWith('task:fork', undefined),
    );
    await tick();
    stdin.write('\x0f');
    await vi.waitFor(() =>
      expect(initial.readExecutionWorkspaceDetail).toHaveBeenCalledWith('task:fork', { offset: 0 }),
    );
    await waitForFrame(lastFrame, (frame) => frame.includes('earlier fork output'));
    expect(initial.readExecutionWorkspaceDetail).toHaveBeenCalledWith('task:fork', { offset: 0 });
    unmount();
  });

  it('the factory is the sole channel source — once at mount, once per switch with the selected sessionId', async () => {
    const { stdin, lastFrame } = renderApp();
    await waitForSessionPicker(lastFrame);
    expect(lastFrame()).toContain('Select a session to resume');

    // Initial channel from the useState initializer, exactly once.
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenNthCalledWith(1, undefined);

    stdin.write('\r'); // select first item (newest first — equal timestamps keep list order)
    await tick();

    // The switch asks the factory for exactly one channel with the id.
    expect(createChannel).toHaveBeenCalledTimes(2);
    expect(createChannel).toHaveBeenNthCalledWith(2, 'session-aaaaaaaa');
  });

  it('the previous channel is stopped before the new one becomes active', async () => {
    const { stdin, lastFrame } = renderApp();
    await waitForSessionPicker(lastFrame);
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

    // Ordering: old stop() was invoked BEFORE the factory built
    // the replacement channel (stop-before-active contract).
    const stopOrder = initialChannel.stop.mock.invocationCallOrder[0]!;
    const replacementOrder = createChannel.mock.invocationCallOrder[1]!;
    expect(stopOrder).toBeLessThan(replacementOrder);
  });

  it('waits for the prior stop to finish before constructing the replacement', async () => {
    const { stdin, lastFrame } = renderApp();
    await waitForSessionPicker(lastFrame);
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
    const { stdin, lastFrame, unmount } = renderApp();
    await waitForSessionPicker(lastFrame);
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

  it('keeps the old channel selected and renders a stop failure', async () => {
    const { stdin, lastFrame } = renderApp();
    await waitForSessionPicker(lastFrame);
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

  it('App renders from the factory alone — no channel prop exists', async () => {
    // The old no-factory fallback is deleted: createChannel
    // is required and `channel` is no longer a prop (enforced at the type level —
    // passing one is a compile error). This pins the runtime half: a render with
    // only the factory boots, starts the initial channel, and keeps rendering.
    const { lastFrame } = renderApp();
    await tick();

    expect(lastFrame()).toBeTruthy();
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(created[0]!.start).toHaveBeenCalled();
  });

  it('renders a start failure, blocks normal input, and retries on Enter', async () => {
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

  it('ignores workspace shortcuts while recovery owns input', async () => {
    initialStartError = new Error('transport start failed');
    const { stdin, lastFrame } = renderApp({ showSessionPickerOnStart: false });
    await waitForFrame(lastFrame, (frame) =>
      frame.includes('TUI start failed: transport start failed'),
    );

    stdin.write('\x02'); // Ctrl+B must not mutate hidden overlay state.
    stdin.write('\r');
    await waitForFrame(lastFrame, () => created[0]!.start.mock.calls.length === 2);
    await tick();

    expect(lastFrame()).not.toContain('Execution workspace');
  });

  it('subscribes to UI events before channel startup', async () => {
    initialStartIntent = true;
    const { lastFrame } = renderApp({ showSessionPickerOnStart: false });

    await waitForSessionPicker(lastFrame);
    expect(lastFrame()).toContain('Select a session to resume');
  });

  it('consecutive switches A→B→C create one channel per switch and stop each prior channel', async () => {
    // Selection always takes the top (newest) entry; arrow-key navigation itself
    // is covered by ListPicker.test.tsx. updatedAt ordering decides the target.
    const ids = ['aaaaaaaa-1111', 'bbbbbbbb-2222', 'cccccccc-3333'];
    const { stdin, lastFrame, records } = renderApp({ sessionIds: ids });
    touch(records, 'aaaaaaaa-1111', '2026-06-13T01:00:00.000Z'); // A on top
    await waitForSessionPicker(lastFrame);

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
    // The session emits `ui_intent` and the owner surface renders it).
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

  /**
   * Stopping a channel cancels the background jobs its session still runs, so a switch that would do
   * that is the person's decision. The picker, `/resume` and a retried switch all end in the same
   * switch, which is where the question is asked.
   */
  describe('switching sessions while background jobs run', () => {
    const FIRST_ROW = 'session-aaaaaaaa';
    const JOBS_QUESTION = /background jobs? (is|are) still running and will be stopped/;

    /** The jobs the session reports, one per status, as its workspace shows them. */
    function reportJobs(channel: IFakeChannel, statuses: readonly string[]): void {
      const entries = statuses.map((status, index) => ({
        id: `task:job_${index}`,
        sourceId: `job_${index}`,
        kind: 'background_task' as const,
        taskKind: 'agent' as const,
        origin: { kind: 'slash_command' as const, sessionId: 'parent' },
        status: status as IExecutionWorkspaceEntry['status'],
        state: 'working' as const,
        title: `job ${index}`,
        subtitle: 'general-purpose',
        unread: false,
        attention: 'none' as const,
        visibility: 'default' as const,
        updatedAt: '2026-11-14T00:00:00.000Z',
        controls: ['select', 'cancel'] as IExecutionWorkspaceEntry['controls'],
      }));
      channel.stateManager.executionWorkspaceSnapshot = {
        sessionId: 'parent',
        selectedEntryId: entries[0]?.id ?? '',
        updatedAt: '2026-11-14T00:00:00.000Z',
        entries,
      };
      channel.onChange?.();
    }

    const said = (channel: IFakeChannel): string => JSON.stringify(channel.stateManager.history);

    /** The question is on screen and its keys are listening: an answer typed now is not lost. */
    async function waitForQuestion(
      lastFrame: () => string | undefined,
      wording: RegExp | string = JOBS_QUESTION,
    ): Promise<void> {
      await waitForFrame(lastFrame, (frame) =>
        typeof wording === 'string' ? frame.includes(wording) : wording.test(frame),
      );
      await tick();
    }

    /** The startup picker is open and the first channel reports `statuses` as its jobs. */
    async function pickerWithJobs(statuses: readonly string[]) {
      const view = renderApp();
      await waitForSessionPicker(view.lastFrame);
      const initial = created[0]!;
      reportJobs(initial, statuses);
      await tick();
      return { ...view, initial };
    }

    it('asks first, naming the jobs, and a decline keeps the session and its jobs', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs([
        'running',
        'queued',
        'completed',
      ]);

      stdin.write('\r'); // the first row of the picker
      await tick();

      expect(initial.stop).not.toHaveBeenCalled();
      expect(createChannel).toHaveBeenCalledTimes(1);
      await waitForQuestion(lastFrame, '2 background jobs are still running and will be stopped');

      stdin.write('n');
      await tick();

      expect(initial.stop).not.toHaveBeenCalled();
      expect(createChannel).toHaveBeenCalledTimes(1);
      expect(lastFrame()).not.toMatch(JOBS_QUESTION);
      expect(lastFrame()).toContain('Type a message');
      expect(said(initial)).toContain('session not switched');
    });

    it('a bare Enter declines: the question opens on No', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs(['running']);

      stdin.write('\r');
      await waitForQuestion(lastFrame, '1 background job is still running and will be stopped');
      stdin.write('\r');
      await tick();

      expect(initial.stop).not.toHaveBeenCalled();
      expect(createChannel).toHaveBeenCalledTimes(1);
    });

    it('stops the jobs with the channel and switches when the person confirms', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs(['running', 'waiting_permission']);

      stdin.write('\r');
      await waitForQuestion(lastFrame);
      expect(initial.stop).not.toHaveBeenCalled();
      stdin.write('y');
      await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);

      expect(initial.stop).toHaveBeenCalledTimes(1);
      expect(createChannel).toHaveBeenNthCalledWith(2, FIRST_ROW);
    });

    it('asks nothing when no job is running', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs(['completed', 'failed']);

      stdin.write('\r');
      await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);

      expect(lastFrame()).not.toMatch(JOBS_QUESTION);
      expect(initial.stop).toHaveBeenCalledTimes(1);
      expect(createChannel).toHaveBeenNthCalledWith(2, FIRST_ROW);
    });

    it('asks on the picker `/resume` opens, not only on the startup picker', async () => {
      const { stdin, lastFrame } = renderApp({ showSessionPickerOnStart: false });
      await tick();
      const initial = created[0]!;
      reportJobs(initial, ['running']);
      initial.emitSessionEvent('ui_intent', {
        intent: { type: 'show-session-picker' },
        requesterDriverId: 'owner',
      });
      await waitForSessionPicker(lastFrame);

      stdin.write('\r');
      await waitForQuestion(lastFrame);
      expect(initial.stop).not.toHaveBeenCalled();
      stdin.write('n');
      await tick();

      expect(initial.stop).not.toHaveBeenCalled();
      expect(createChannel).toHaveBeenCalledTimes(1);
    });

    it('asks again when more jobs started while the question was open, on a fresh No', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs(['running']);

      stdin.write('\r');
      await waitForQuestion(lastFrame, '1 background job is still');
      reportJobs(initial, ['running', 'running']);
      await tick();
      stdin.write('y');
      await waitForQuestion(lastFrame, '2 background jobs are still');
      expect(initial.stop).not.toHaveBeenCalled();

      // The new question is its own: the earlier yes does not carry into it.
      stdin.write('\r');
      await tick();
      expect(initial.stop).not.toHaveBeenCalled();
      expect(createChannel).toHaveBeenCalledTimes(1);
    });

    it('retries a failed switch without asking again what the person already agreed to', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs(['running']);
      initial.stop.mockRejectedValueOnce(new Error('transport stop failed'));

      stdin.write('\r');
      await waitForQuestion(lastFrame);
      stdin.write('y');
      await waitForFrame(lastFrame, (frame) => frame.includes('Session switch failed'));
      await tick();
      stdin.write('\r');
      await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);

      expect(initial.stop).toHaveBeenCalledTimes(2);
      expect(lastFrame()).not.toMatch(JOBS_QUESTION);
    });

    it('a retry asks again, in place of the failure, when more jobs started since the person agreed', async () => {
      const { stdin, lastFrame, initial } = await pickerWithJobs(['running']);
      initial.stop.mockRejectedValueOnce(new Error('transport stop failed'));

      stdin.write('\r');
      await waitForQuestion(lastFrame);
      stdin.write('y');
      await waitForFrame(lastFrame, (frame) => frame.includes('Session switch failed'));
      reportJobs(initial, ['running', 'queued']);
      await tick();
      stdin.write('\r');
      await waitForQuestion(lastFrame, '2 background jobs are still');

      expect(lastFrame()).not.toContain('Session switch failed');
      expect(initial.stop).toHaveBeenCalledTimes(1);
    });

    it('in screen-reader mode the question is plain text, answered by typing y or n', async () => {
      const store = createFakeStore([sessionRecord(FIRST_ROW, cwd)]);
      const { stdin, lastFrame } = render(
        <ScreenReaderProvider enabled={true}>
          <App
            cwd={cwd}
            createChannel={createChannel}
            sessionStore={store}
            showSessionPickerOnStart
            cliAdapter={createCliAdapter(join(cwd, 'settings.json'))}
          />
        </ScreenReaderProvider>,
      );
      await waitForSessionPicker(lastFrame);
      const initial = created[0]!;
      reportJobs(initial, ['running']);
      await tick();

      stdin.write('1');
      await tick();
      stdin.write('\r');
      await waitForQuestion(lastFrame);
      expect(lastFrame()).toContain('Answer y or n and press Enter');
      expect(lastFrame()).not.toMatch(/[╭╮╰╯│]/u);
      stdin.write('n');
      await tick();
      stdin.write('\r');
      await tick();
      expect(initial.stop).not.toHaveBeenCalled();
      expect(said(initial)).toContain('session not switched');

      initial.emitSessionEvent('ui_intent', {
        intent: { type: 'show-session-picker' },
        requesterDriverId: 'owner',
      });
      await waitForSessionPicker(lastFrame);
      stdin.write('1');
      await tick();
      stdin.write('\r');
      await waitForQuestion(lastFrame);
      stdin.write('y');
      await tick();
      stdin.write('\r');
      await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);
      expect(initial.stop).toHaveBeenCalledTimes(1);
    });

    it('asks nothing of a terminal attached to a host: the host keeps its jobs', async () => {
      const requestSessionSwitch = vi.fn(async () => {});
      const records = [sessionRecord(FIRST_ROW, cwd)];
      const { stdin, lastFrame } = render(
        <App
          cwd={cwd}
          createChannel={createChannel}
          sessionStore={createFakeStore(records)}
          requestSessionSwitch={requestSessionSwitch}
          showSessionPickerOnStart
          cliAdapter={createCliAdapter(join(cwd, 'settings.json'))}
        />,
      );
      await waitForSessionPicker(lastFrame);
      reportJobs(created[0]!, ['running']);
      await tick();

      stdin.write('\r');
      await waitForFrame(lastFrame, () => requestSessionSwitch.mock.calls.length === 1);

      expect(requestSessionSwitch).toHaveBeenCalledWith(FIRST_ROW);
      expect(lastFrame()).not.toMatch(JOBS_QUESTION);
      expect(created[0]!.stop).not.toHaveBeenCalled();
    });
  });
});

/**
 * The store refuses to claim the session the person picked, because a process or a subagent
 * holds it. The refusal comes from the new channel's own claim, which the in-process switch makes after
 * it has stopped the old one, so a held id is asked about first and the person stays where they are.
 */
describe('picking a session the store will not claim', () => {
  const HELD_ID = 'session_aaaaaaaa-held';
  // Windows reads no process start time, so the store cannot say the holder is alive and says it may be.
  const HOLDER_OPEN = process.platform === 'win32' ? 'may be open' : 'is open';
  const FREE_ID = 'session_bbbbbbbb-free';
  const CURRENT_ID = 'session_cccccccc-current';
  const DOWN = '\x1b[B';

  let directory: string;
  let store: IInteractiveSessionStore;
  let created: (IFakeChannel & ITuiAppChannelPort)[];
  let createChannel: ReturnType<typeof vi.fn>;
  /** Runs inside the factory just before the claim of the picked session, as a writer arriving late would. */
  let beforeClaim: (() => void) | undefined;

  /** A live process other than this one: the one that started this test worker. */
  function liveOther() {
    const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
    const startTime = readProcessStartTime(process.ppid);
    return { ...here, pid: process.ppid, ...(startTime === undefined ? {} : { startTime }) };
  }

  const holdBy = (id: string): void => {
    leaveProcessMarker(join(directory, 'claims'), id, liveOther());
  };

  function stored(id: string, updatedAt: string): IInteractiveSessionRecord {
    return {
      id,
      cwd: directory,
      createdAt: updatedAt,
      updatedAt,
      messages: [
        {
          id: `${id}-m`,
          role: 'assistant',
          content: `reply in ${id}`,
          state: 'complete',
          timestamp: new Date(updatedAt),
        },
      ],
    } as IInteractiveSessionRecord;
  }

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), 'agent-pick-held-')));
    store = createNodeHostSessionStore(directory, { sealing: 'plain' });
    // The held session is the newest, so it is the first row of the picker.
    store.save(stored(FREE_ID, '2026-06-13T00:00:00.000Z'));
    store.save(stored(HELD_ID, '2026-06-13T01:00:00.000Z'));
    store.save(stored(CURRENT_ID, '2026-06-12T00:00:00.000Z'));
    created = [];
    beforeClaim = undefined;
    createChannel = vi.fn((resumeSessionId?: string) => {
      if (resumeSessionId === HELD_ID) {
        beforeClaim?.();
        // What the new channel's session does while it is built: claim the record it resumes.
        store.claim(HELD_ID);
        throw new Error('the claim was granted, which this test arranges not to happen');
      }
      const fake = createFakeChannel(resumeSessionId);
      // The session the person is on reports its own id, as a started session does.
      fake.getRuntimeStatusSnapshot = (permissionMode) => ({
        permissionMode,
        sessionId: resumeSessionId ?? CURRENT_ID,
      });
      created.push(fake);
      return fake;
    });
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function renderPicker() {
    return render(
      <App
        cwd={directory}
        createChannel={createChannel}
        sessionStore={store}
        showSessionPickerOnStart
        cliAdapter={createCliAdapter(join(directory, 'settings.json'))}
      />,
    );
  }

  /** What was written into a channel's transcript, as one string. */
  const saidIn = (channel: IFakeChannel): string => JSON.stringify(channel.stateManager.history);

  it('leaves the person on their session with the store’s words, not a blocked UI', async () => {
    const { stdin, lastFrame } = renderPicker();
    await waitForSessionPicker(lastFrame);
    holdBy(HELD_ID);

    stdin.write('\r'); // the newest row: the held session
    await waitForFrame(
      () => saidIn(created[0]!),
      (said) => said.includes(`pid ${process.ppid}`),
    );

    // Nothing was stopped or built over the held id, and the notice is the store's.
    expect(created[0]!.stop).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(saidIn(created[0]!)).toContain(`Session ${HELD_ID} ${HOLDER_OPEN} in another process`);
    expect(lastFrame()).not.toContain('Session switch failed');
    expect(lastFrame()).not.toContain('Press Enter to retry');

    // The UI is not blocked: the person picks the other session from the same terminal.
    created[0]!.emitSessionEvent('ui_intent', {
      intent: { type: 'show-session-picker' },
      requesterDriverId: 'owner',
    });
    await waitForSessionPicker(lastFrame);
    stdin.write(DOWN);
    await tick();
    stdin.write('\r');
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);
    expect(createChannel).toHaveBeenNthCalledWith(2, FREE_ID);
    expect(created[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it('refuses a held session before asking about jobs: nothing would be stopped, so nothing is asked', async () => {
    const { stdin, lastFrame } = renderPicker();
    await waitForSessionPicker(lastFrame);
    created[0]!.stateManager.executionWorkspaceSnapshot = {
      sessionId: CURRENT_ID,
      selectedEntryId: 'task:job',
      updatedAt: '2026-11-14T00:00:00.000Z',
      entries: [
        {
          id: 'task:job',
          sourceId: 'job',
          kind: 'background_task',
          taskKind: 'agent',
          origin: { kind: 'slash_command', sessionId: CURRENT_ID },
          status: 'running',
          state: 'working',
          title: 'job',
          unread: false,
          attention: 'none',
          visibility: 'default',
          updatedAt: '2026-11-14T00:00:00.000Z',
          controls: ['select', 'cancel'],
        },
      ],
    };
    created[0]!.onChange?.();
    await tick();
    holdBy(HELD_ID);

    stdin.write('\r'); // the newest row: the held session
    await waitForFrame(
      () => saidIn(created[0]!),
      (said) => said.includes(`pid ${process.ppid}`),
    );

    expect(lastFrame()).not.toContain('will be stopped');
    expect(created[0]!.stop).not.toHaveBeenCalled();
  });

  it('still reopens the session the person is on when they pick it again, though its own claim holds the id', async () => {
    const running = store.claim(CURRENT_ID);
    const { stdin, lastFrame } = renderPicker();
    await waitForSessionPicker(lastFrame);

    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write('\r'); // the oldest row: the session the person is on
    await waitForFrame(lastFrame, () => createChannel.mock.calls.length === 2);

    expect(createChannel).toHaveBeenNthCalledWith(2, CURRENT_ID);
    expect(created[0]!.stop).toHaveBeenCalledTimes(1);
    running.release();
  });

  it('returns to the session the person was on when the claim is lost after it ended, and does not try the same id again', async () => {
    const { stdin, lastFrame } = renderPicker();
    await waitForSessionPicker(lastFrame);
    // The id was free when it was asked about, and a writer took it before the new session claimed it.
    beforeClaim = () => holdBy(HELD_ID);

    stdin.write('\r');
    await waitForFrame(lastFrame, () => created.length === 2);

    // The previous session is open again, under its own id, with the store's words in its transcript.
    expect(created[0]!.stop).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenCalledTimes(3);
    expect(createChannel).toHaveBeenNthCalledWith(2, HELD_ID);
    expect(createChannel).toHaveBeenNthCalledWith(3, CURRENT_ID);
    expect(saidIn(created[1]!)).toContain(`pid ${process.ppid}`);
    expect(lastFrame()).not.toContain('Session switch failed');
    expect(lastFrame()).not.toContain('Press Enter to retry');
  });
});
