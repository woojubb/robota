/**
 * Picking an unverified record in the resume picker, over a store that seals. A record that opens says
 * nothing about who wrote it, so the pick does not resume it: the person is told so in fixed text and
 * asked whether it is theirs, nothing is written until they say yes, and the switch then carries the
 * digest of exactly the bytes they were asked about.
 *
 * The real App, a fake channel factory and a fake sealing store; the keys are typed through the real
 * picker and prompt.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  unacceptableSessionMessage,
  UNVERIFIED_SESSION_QUESTION,
  unverifiedSessionNotice,
} from '@robota-sdk/agent-framework';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App.js';
import { localPickerDecisions } from '../session-picker-decisions.js';

import type { ITuiAppChannelPort, ITuiChannelSnapshot } from '../tui-app-channel-port.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListingEntry,
  IOwnerSessionDirectory,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface/session';

const TICK_MS = 30;
const FRAME_DEADLINE_MS = 3000;
const DOWN = '\x1b[B';
const LEFT = '\x1b[D';
const ENTER = '\r';

// `session_` ids list by the part after it: 11111111 and 22222222.
const VERIFIED_ID = 'session_11111111-aaaa';
const UNVERIFIED_ID = 'session_22222222-bbbb';
const DIGEST = 'ab'.repeat(32);
const QUESTION_ID = 'question-1';

const OWN_NAME = 'OWN-NAME';
// Everything an unverified record says about itself, which must never reach the person before they decide.
const PLANTED_NAME = 'PLANTED-NAME';
const PLANTED_TITLE = 'PLANTED-TITLE';
const PLANTED_PREVIEW = 'PLANTED-PREVIEW';

function tick(ms = TICK_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, describeFailure: () => string): Promise<void> {
  const deadline = Date.now() + FRAME_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await tick(10);
  }
  throw new Error(`waitFor timeout\n${describeFailure()}`);
}

/** A frame as one line of words: the prompt's border and the terminal's wrapping do not matter. */
function words(text: string): string {
  return text
    .replace(/[│╭╮╰╯─]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface IFakeChannel extends ITuiAppChannelPort {
  /** Every system message written to this channel's transcript, as JSON. */
  readonly said: () => string[];
  /** The operator runs `/resume`. */
  readonly openResumePicker: () => void;
  readonly setHostSessions: (sessions: readonly ISessionListingEntry[]) => void;
}

function fakeChannel(hostSessions?: readonly ISessionListingEntry[]): IFakeChannel {
  let currentHostSessions = hostSessions;
  let history: readonly IHistoryEntry[] = [];
  const listeners = new Set<() => void>();
  const intentHandlers = new Set<(event: unknown) => void>();
  const port = {
    on: (event: string, handler: (event: unknown) => void): void => {
      if (event === 'ui_intent') intentHandlers.add(handler);
    },
    off: (event: string, handler: (event: unknown) => void): void => {
      if (event === 'ui_intent') intentHandlers.delete(handler);
    },
  };
  const queries = { getCommands: (): never[] => [], getSubcommands: (): never[] => [] };
  const snapshot = (): ITuiChannelSnapshot => ({
    history,
    streamingText: '',
    activeTools: [],
    isThinking: false,
    isAborting: false,
    lastErrorMessage: null,
    isStalled: false,
    sessionEventNotices: [],
    isShuttingDown: false,
    pendingPrompt: null,
    pendingCount: 0,
    executionWorkspaceSnapshot: null,
    permissionRequest: null,
    pendingUserAction: null,
    contextState: { percentage: 0, usedTokens: 0, maxTokens: 0 },
    ...(currentHostSessions === undefined ? {} : { hostSessions: currentHostSessions }),
  });
  const idle = vi.fn(async () => undefined);
  return {
    terminalHandoffController: undefined,
    sessionName: undefined,
    start: idle,
    stop: idle,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: snapshot,
    getCommandQueryPort: () => queries,
    getSessionUiEventPort: () =>
      port as unknown as ReturnType<ITuiAppChannelPort['getSessionUiEventPort']>,
    getRuntimeStatusSnapshot: (permissionMode) => ({ permissionMode, sessionId: '' }),
    addEntry: (entry) => {
      history = [...history, entry];
      for (const listener of [...listeners]) listener();
    },
    handleInput: idle,
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    stopWaitingSelfPacedLoop: idle,
    shutdown: idle,
    selectExecutionWorkspaceEntry: vi.fn(),
    readExecutionWorkspaceDetail: async (entryId) => ({ entryId, records: [] }),
    sendAgentJob: idle,
    resolveUserAction: vi.fn(),
    said: () => history.map((entry) => JSON.stringify(entry)),
    setHostSessions: (sessions) => {
      currentHostSessions = sessions;
      for (const listener of [...listeners]) listener();
    },
    openResumePicker: () => {
      for (const handler of [...intentHandlers]) {
        handler({ intent: { type: 'show-session-picker' }, requesterDriverId: 'owner' });
      }
    },
  };
}

function record(id: string, cwd: string, planted: boolean): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    name: planted ? PLANTED_NAME : OWN_NAME,
    messages: [
      { role: 'user', content: planted ? PLANTED_TITLE : 'my own work' },
      { role: 'assistant', content: planted ? PLANTED_PREVIEW : 'my own reply' },
    ] as IInteractiveSessionRecord['messages'],
  };
}

interface IStoreScript {
  /** What a plain read answers for an id, in place of the listing's own answer. */
  readonly probe?: (id: string) => TSessionLoadOutcome;
}

type TFakeStore = IInteractiveSessionStore & {
  readonly load: ReturnType<typeof vi.fn>;
  /** The store's raise, which only the session that restores the record may call. */
  readonly adopt: ReturnType<typeof vi.fn>;
};

/** A store that seals: a verified record and an unverified one, and the answers a test scripts. */
function sealingStore(cwd: string, script: IStoreScript = {}): TFakeStore {
  const verified = record(VERIFIED_ID, cwd, false);
  const unverified = record(UNVERIFIED_ID, cwd, true);
  const outcomeOf = (id: string): TSessionLoadOutcome =>
    id === VERIFIED_ID
      ? { status: 'valid', record: verified, authorship: 'verified', digest: 'cd'.repeat(32) }
      : id === UNVERIFIED_ID
        ? { status: 'valid', record: unverified, authorship: 'unverified', digest: DIGEST }
        : { status: 'missing' };
  const adopt = vi.fn(() => 'adopted' as const);
  const store = withHoldReadClaim({
    save: () => undefined,
    delete: () => undefined,
    load: vi.fn((id: string) => (script.probe ?? outcomeOf)(id)),
    list: () => [
      { id: VERIFIED_ID, outcome: outcomeOf(VERIFIED_ID) },
      { id: UNVERIFIED_ID, outcome: outcomeOf(UNVERIFIED_ID) },
    ],
    authorship: {
      adopt,
      heldDigest: () => undefined,
      onUnlock: () => () => undefined,
    },
    adopt,
  });
  return store as TFakeStore;
}

function cliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: () => ({}),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

describe('resuming an unverified record from the picker', () => {
  let cwd: string;
  let channels: IFakeChannel[];
  let hostSessions: readonly ISessionListingEntry[] | undefined;
  let createChannel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'agent-unverified-resume-'));
    channels = [];
    hostSessions = undefined;
    createChannel = vi.fn(() => {
      const channel = fakeChannel(hostSessions);
      channels.push(channel);
      return channel;
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  type TView = ReturnType<typeof render>;

  function openPicker(
    store: IInteractiveSessionStore,
    requestSessionSwitch?: (sessionId: string) => Promise<void>,
    ownerSessions?: IOwnerSessionDirectory,
    onOwnerInvalidated?: (listener: () => void) => () => void,
  ): TView {
    return render(
      <App
        cwd={cwd}
        createChannel={createChannel}
        sessionStore={store}
        showSessionPickerOnStart
        {...(requestSessionSwitch === undefined ? {} : { requestSessionSwitch })}
        {...(ownerSessions === undefined ? {} : { ownerSessions })}
        {...(onOwnerInvalidated === undefined ? {} : { onOwnerInvalidated })}
        cliAdapter={cliAdapter(join(cwd, 'settings.json'))}
      />,
    );
  }

  async function pickerShown(view: TView): Promise<string> {
    await waitFor(
      () => (view.lastFrame() ?? '').includes('Select a session to resume'),
      () => view.lastFrame() ?? '<none>',
    );
    await tick();
    return view.lastFrame() ?? '';
  }

  /** Verified records list first, so the unverified one is the second row. */
  async function pickUnverified(view: TView): Promise<void> {
    view.stdin.write(DOWN);
    await tick();
    view.stdin.write(ENTER);
  }

  async function questionShown(view: TView): Promise<string> {
    await waitFor(
      () => (view.lastFrame() ?? '').includes(UNVERIFIED_SESSION_QUESTION),
      () => view.lastFrame() ?? '<none>',
    );
    await tick();
    return view.lastFrame() ?? '';
  }

  async function saidInTranscript(view: TView, text: string): Promise<void> {
    await waitFor(
      () => channels[0]!.said().some((entry) => entry.includes(text)),
      () => view.lastFrame() ?? '<none>',
    );
  }

  it('marks the unverified record in the picker and no other', async () => {
    const view = openPicker(sealingStore(cwd));
    const frame = await pickerShown(view);
    view.unmount();

    const rowOf = (text: string): string =>
      frame.split('\n').find((line) => line.includes(text)) ?? '';
    expect(rowOf(PLANTED_NAME)).toContain('unverified');
    expect(rowOf(OWN_NAME)).not.toContain('unverified');
  });

  it('asks in fixed text, with no word the record supplied, and writes nothing before the answer', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    const frame = await questionShown(view);
    view.unmount();

    expect(words(frame)).toContain(words(unverifiedSessionNotice(UNVERIFIED_ID)));
    for (const planted of [PLANTED_NAME, PLANTED_TITLE, PLANTED_PREVIEW]) {
      expect(frame).not.toContain(planted);
    }
    // The picker gave way to the question: nothing is open to pick again until it is answered.
    expect(frame).not.toContain('Select a session to resume');
    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it('reads the record it will ask about with a plain load of that id', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await questionShown(view);
    view.unmount();

    expect(store.load).toHaveBeenCalledWith(UNVERIFIED_ID);
  });

  it('opens on No, so a bare Enter writes nothing, switches nothing and says it was cancelled', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    const frame = await questionShown(view);
    expect(frame).toContain('> No');
    expect(frame).not.toContain('> Yes');

    view.stdin.write(ENTER);
    await saidInTranscript(view, 'Session resume cancelled.');
    await tick();
    const after = view.lastFrame() ?? '';
    view.unmount();

    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(after).not.toContain(UNVERIFIED_SESSION_QUESTION);
    expect(after).not.toContain('Select a session to resume');
  });

  it('writes nothing for n either, and asks afresh the next time the picker opens', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await questionShown(view);

    view.stdin.write('n');
    await saidInTranscript(view, 'Session resume cancelled.');
    await tick();
    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);

    // `/resume` again: the list, not the answered question.
    channels[0]!.openResumePicker();
    const reopened = await pickerShown(view);
    view.unmount();
    expect(reopened).not.toContain(UNVERIFIED_SESSION_QUESTION);
  });

  it('switches carrying exactly the digest of the bytes the probe read on yes, raising nothing itself', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await questionShown(view);

    view.stdin.write('y');
    await waitFor(
      () => createChannel.mock.calls.length === 2,
      () => view.lastFrame() ?? '<none>',
    );
    view.unmount();

    // The session that opens the record raises the accepted bytes, once it has restored from them.
    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenNthCalledWith(2, UNVERIFIED_ID, DIGEST);
  });

  it('does the same on an arrow to Yes and Enter', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await questionShown(view);

    view.stdin.write(LEFT);
    await tick();
    view.stdin.write(ENTER);
    await waitFor(
      () => createChannel.mock.calls.length === 2,
      () => view.lastFrame() ?? '<none>',
    );
    view.unmount();

    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenNthCalledWith(2, UNVERIFIED_ID, DIGEST);
  });

  it('says a replay-only record cannot be accepted, asks nothing, and writes and switches nothing', async () => {
    const store = sealingStore(cwd, {
      probe: (id) => ({
        status: 'valid',
        record: record(id, cwd, true),
        authorship: 'unverified',
      }),
    });
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await saidInTranscript(view, unacceptableSessionMessage(UNVERIFIED_ID));
    await tick();
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(frame).not.toContain(UNVERIFIED_SESSION_QUESTION);
    expect(frame).not.toContain('Select a session to resume');
    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it('switches at once, with only the id, to a record the owner wrote', async () => {
    const store = sealingStore(cwd);
    const view = openPicker(store);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await waitFor(
      () => createChannel.mock.calls.length === 2,
      () => view.lastFrame() ?? '<none>',
    );
    view.unmount();

    expect(createChannel.mock.calls[1]).toEqual([VERIFIED_ID]);
    expect(store.adopt).not.toHaveBeenCalled();
  });

  it('leaves the session to judge a record that is no longer unverified when it is picked', async () => {
    const store = sealingStore(cwd, {
      probe: (id) => ({
        status: 'valid',
        record: record(id, cwd, false),
        authorship: 'verified',
        digest: DIGEST,
      }),
    });
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await waitFor(
      () => createChannel.mock.calls.length === 2,
      () => view.lastFrame() ?? '<none>',
    );
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(frame).not.toContain(UNVERIFIED_SESSION_QUESTION);
    expect(createChannel.mock.calls[1]).toEqual([UNVERIFIED_ID]);
    expect(store.adopt).not.toHaveBeenCalled();
  });

  it('keeps the digest when a failed switch is retried', async () => {
    const store = sealingStore(cwd);
    let attempts = 0;
    createChannel = vi.fn(() => {
      attempts += 1;
      if (attempts === 2) throw new Error('boom');
      const channel = fakeChannel();
      channels.push(channel);
      return channel;
    });
    const view = openPicker(store);
    await pickerShown(view);
    await pickUnverified(view);
    await questionShown(view);

    view.stdin.write('y');
    await waitFor(
      () => (view.lastFrame() ?? '').includes('Session switch failed: boom'),
      () => view.lastFrame() ?? '<none>',
    );
    await tick();
    view.stdin.write(ENTER);
    await waitFor(
      () => createChannel.mock.calls.length === 3,
      () => view.lastFrame() ?? '<none>',
    );
    view.unmount();

    expect(createChannel).toHaveBeenNthCalledWith(2, UNVERIFIED_ID, DIGEST);
    expect(createChannel).toHaveBeenNthCalledWith(3, UNVERIFIED_ID, DIGEST);
    // Nothing is raised by the picker, however often the switch is tried.
    expect(store.adopt).not.toHaveBeenCalled();
  });

  it("leaves a host's listing to the host: it asks the host to switch, and reads no local record", async () => {
    hostSessions = [
      {
        id: UNVERIFIED_ID,
        name: 'Host session',
        cwd,
        updatedAt: '2026-09-07T00:00:00.000Z',
        messageCount: 2,
        preview: '',
        authorship: 'unverified',
      },
    ];
    const store = sealingStore(cwd);
    const requestSessionSwitch = vi.fn(async () => undefined);
    const view = openPicker(store, requestSessionSwitch);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await waitFor(
      () => requestSessionSwitch.mock.calls.length === 1,
      () => view.lastFrame() ?? '<none>',
    );
    const frame = view.lastFrame() ?? '';
    view.unmount();

    expect(requestSessionSwitch).toHaveBeenCalledWith(UNVERIFIED_ID);
    expect(frame).not.toContain(UNVERIFIED_SESSION_QUESTION);
    expect(store.load).not.toHaveBeenCalled();
    expect(store.adopt).not.toHaveBeenCalled();
    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it('asks a secure owner in fixed words and sends acceptance only through the owner port', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, name: PLANTED_NAME, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 2, preview: PLANTED_PREVIEW, authorship: 'unverified' }];
    const requestSessionSwitch = vi.fn(async () => undefined);
    const ownerSessions: IOwnerSessionDirectory = {
      question: vi.fn(async () => ({ kind: 'accept' as const, digest: DIGEST, questionId: QUESTION_ID, notice: 'PLANTED-NOTICE', question: 'PLANTED-QUESTION' })),
      openAccepted: vi.fn(async () => undefined),
      cancelQuestion: vi.fn(async () => undefined),
    };
    const view = openPicker(sealingStore(cwd), requestSessionSwitch, ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    const frame = await questionShown(view);
    expect(words(frame)).toContain(words(unverifiedSessionNotice(UNVERIFIED_ID)));
    expect(frame).not.toContain('PLANTED-NOTICE');
    expect(frame).not.toContain('PLANTED-QUESTION');
    expect(frame).toContain('> No');
    view.stdin.write('y');
    await waitFor(() => vi.mocked(ownerSessions.openAccepted).mock.calls.length === 1, () => view.lastFrame() ?? '<none>');
    expect(ownerSessions.openAccepted).toHaveBeenCalledWith(UNVERIFIED_ID, DIGEST, QUESTION_ID);
    expect(requestSessionSwitch).not.toHaveBeenCalled();
    view.unmount();
  });

  it('discards a late owner question after the picker is cancelled', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    let reply!: (value: Awaited<ReturnType<IOwnerSessionDirectory['question']>>) => void;
    const ownerSessions = {
      question: () => new Promise<Awaited<ReturnType<IOwnerSessionDirectory['question']>>>((resolve) => { reply = resolve; }),
      openAccepted: vi.fn(),
      cancelQuestion: vi.fn(async () => undefined),
    };
    const requestSessionSwitch = vi.fn(async () => undefined);
    const view = openPicker(sealingStore(cwd), requestSessionSwitch, ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write('\u001b');
    await saidInTranscript(view, 'Session resume cancelled.');
    expect(ownerSessions.cancelQuestion).toHaveBeenCalledOnce();
    reply({ kind: 'open' });
    await tick();
    expect(requestSessionSwitch).not.toHaveBeenCalled();
    expect(ownerSessions.openAccepted).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each([
    { kind: 'open' as const },
    { kind: 'accept' as const, digest: DIGEST, questionId: QUESTION_ID, notice: 'untrusted', question: 'untrusted' },
  ])('discards an earlier $kind answer after the person selects another session', async (lateReply) => {
    hostSessions = [VERIFIED_ID, UNVERIFIED_ID].map((id) => ({ id, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '' }));
    let firstReply!: (value: Awaited<ReturnType<IOwnerSessionDirectory['question']>>) => void;
    let finishCancel!: () => void;
    const ownerSessions = {
      question: vi.fn((id: string) => id === VERIFIED_ID
        ? new Promise<Awaited<ReturnType<IOwnerSessionDirectory['question']>>>((resolve) => { firstReply = resolve; })
        : Promise.resolve({ kind: 'open' as const })),
      openAccepted: vi.fn(),
      cancelQuestion: vi.fn(() => new Promise<void>((resolve) => { finishCancel = resolve; })),
    };
    const requestSessionSwitch = vi.fn(async () => undefined);
    const view = openPicker(sealingStore(cwd), requestSessionSwitch, ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await tick();
    view.stdin.write(DOWN);
    await tick();
    view.stdin.write(ENTER);
    await waitFor(() => requestSessionSwitch.mock.calls.length === 1, () => view.lastFrame() ?? '<none>');
    expect(ownerSessions.cancelQuestion).toHaveBeenCalledOnce();
    expect(ownerSessions.question.mock.invocationCallOrder[0]).toBeLessThan(ownerSessions.cancelQuestion.mock.invocationCallOrder[0]!);
    expect(ownerSessions.cancelQuestion.mock.invocationCallOrder[0]).toBeLessThan(ownerSessions.question.mock.invocationCallOrder[1]!);
    firstReply(lateReply);
    finishCancel();
    await tick();
    expect(requestSessionSwitch).toHaveBeenCalledExactlyOnceWith(UNVERIFIED_ID);
    expect(ownerSessions.openAccepted).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not send owner acceptance when the default No is chosen', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    const ownerSessions = {
      question: async () => ({ kind: 'accept' as const, digest: DIGEST, questionId: QUESTION_ID, notice: '', question: '' }),
      openAccepted: vi.fn(),
      cancelQuestion: vi.fn(async () => undefined),
    };
    const view = openPicker(sealingStore(cwd), vi.fn(async () => undefined), ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await questionShown(view);
    view.stdin.write(ENTER);
    await saidInTranscript(view, 'Session resume cancelled.');
    expect(ownerSessions.cancelQuestion).toHaveBeenCalledOnce();
    expect(ownerSessions.openAccepted).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels the issued owner question when the view unmounts', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    const ownerSessions = {
      question: async () => ({ kind: 'accept' as const, digest: DIGEST, questionId: QUESTION_ID, notice: '', question: '' }),
      openAccepted: vi.fn(),
      cancelQuestion: vi.fn(async () => undefined),
    };
    const view = openPicker(sealingStore(cwd), vi.fn(async () => undefined), ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await questionShown(view);
    view.unmount();
    await waitFor(() => ownerSessions.cancelQuestion.mock.calls.length === 1, () => 'owner question was not cancelled');
  });

  it('refuses an unsafe session id without displaying it or sending an owner question', async () => {
    const unsafeId = 'session_\u001b[2Jbad';
    hostSessions = [{ id: unsafeId, name: 'unsafe', cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    const ownerSessions: IOwnerSessionDirectory = { question: vi.fn(), openAccepted: vi.fn(), cancelQuestion: vi.fn() };
    const requestSessionSwitch = vi.fn(async () => undefined);
    const view = openPicker(sealingStore(cwd), requestSessionSwitch, ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await saidInTranscript(view, 'The session could not be resumed.');
    expect(ownerSessions.question).not.toHaveBeenCalled();
    expect(requestSessionSwitch).not.toHaveBeenCalled();
    view.unmount();
  });

  it('withdraws the question when the owner link locks or closes', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    const ownerSessions: IOwnerSessionDirectory = {
      question: async () => ({ kind: 'accept', digest: DIGEST, questionId: QUESTION_ID, notice: '', question: '' }),
      openAccepted: vi.fn(),
      cancelQuestion: vi.fn(),
    };
    let invalidate!: () => void;
    const view = openPicker(sealingStore(cwd), vi.fn(async () => undefined), ownerSessions,
      (listener) => { invalidate = listener; return () => undefined; });
    await pickerShown(view);
    view.stdin.write(ENTER);
    await questionShown(view);
    invalidate();
    await waitFor(() => !(view.lastFrame() ?? '').includes(UNVERIFIED_SESSION_QUESTION), () => view.lastFrame() ?? '<none>');
    view.stdin.write('y');
    await tick();
    expect(ownerSessions.openAccepted).not.toHaveBeenCalled();
    view.unmount();
  });

  it('withdraws an earlier question when the owner connection changes', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    const original: IOwnerSessionDirectory = {
      question: async () => ({ kind: 'accept', digest: DIGEST, questionId: QUESTION_ID, notice: '', question: '' }),
      cancelQuestion: vi.fn(),
      openAccepted: vi.fn(),
    };
    const replacement: IOwnerSessionDirectory = { question: vi.fn(), cancelQuestion: vi.fn(), openAccepted: vi.fn() };
    const store = sealingStore(cwd);
    const requestSessionSwitch = vi.fn(async () => undefined);
    const view = openPicker(store, requestSessionSwitch, original);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await questionShown(view);
    view.rerender(<App cwd={cwd} createChannel={createChannel} sessionStore={store} showSessionPickerOnStart requestSessionSwitch={requestSessionSwitch} ownerSessions={replacement} cliAdapter={cliAdapter(join(cwd, 'settings.json'))} />);
    await tick();
    expect(original.cancelQuestion).toHaveBeenCalledOnce();
    expect(view.lastFrame()).not.toContain(UNVERIFIED_SESSION_QUESTION);
    view.stdin.write('y');
    await tick();
    expect(original.openAccepted).not.toHaveBeenCalled();
    expect(replacement.openAccepted).not.toHaveBeenCalled();
    view.unmount();
  });

  it('withdraws a local question when the session store changes', async () => {
    const firstStore = sealingStore(cwd);
    const secondStore = sealingStore(cwd);
    const view = openPicker(firstStore);
    await pickerShown(view);
    await pickUnverified(view);
    await questionShown(view);
    view.rerender(<App cwd={cwd} createChannel={createChannel} sessionStore={secondStore} showSessionPickerOnStart cliAdapter={cliAdapter(join(cwd, 'settings.json'))} />);
    await tick();
    expect(view.lastFrame()).not.toContain(UNVERIFIED_SESSION_QUESTION);
    view.stdin.write('y');
    await tick();
    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(secondStore.adopt).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps a question when the same host publishes a refreshed session listing', async () => {
    hostSessions = [{ id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' }];
    const ownerSessions: IOwnerSessionDirectory = {
      question: async () => ({ kind: 'accept', digest: DIGEST, questionId: QUESTION_ID, notice: '', question: '' }),
      cancelQuestion: vi.fn(),
      openAccepted: vi.fn(),
    };
    const view = openPicker(sealingStore(cwd), vi.fn(async () => undefined), ownerSessions);
    await pickerShown(view);
    view.stdin.write(ENTER);
    await questionShown(view);
    channels[0]!.setHostSessions([...hostSessions]);
    await tick();
    expect(view.lastFrame()).toContain(UNVERIFIED_SESSION_QUESTION);
    expect(ownerSessions.cancelQuestion).not.toHaveBeenCalled();
    view.unmount();
  });

  it('rejects an earlier local answer after reissuing the same question and consumes each answer once', async () => {
    const store = sealingStore(cwd);
    const session = { id: UNVERIFIED_ID, cwd, updatedAt: '2026-09-07T00:00:00.000Z', messageCount: 0, preview: '', authorship: 'unverified' as const };
    const switchSession = vi.fn(async () => undefined);
    const decisions = localPickerDecisions(store, () => [session], switchSession);
    const first = await decisions.question(UNVERIFIED_ID);
    const second = await decisions.question(UNVERIFIED_ID);
    if (first.kind !== 'accept' || second.kind !== 'accept') throw new Error('Expected acceptance questions');
    expect(second.questionId).not.toBe(first.questionId);
    await expect(async () => decisions.openAccepted(UNVERIFIED_ID, DIGEST, first.questionId)).rejects.toThrow();
    expect(switchSession).not.toHaveBeenCalled();
    await decisions.openAccepted(UNVERIFIED_ID, DIGEST, second.questionId);
    expect(switchSession).toHaveBeenCalledExactlyOnceWith(UNVERIFIED_ID, { acceptedDigest: DIGEST });
    await expect(async () => decisions.openAccepted(UNVERIFIED_ID, DIGEST, second.questionId)).rejects.toThrow();
    const third = await decisions.question(UNVERIFIED_ID);
    if (third.kind !== 'accept') throw new Error('Expected acceptance question');
    await decisions.cancelQuestion();
    await expect(async () => decisions.openAccepted(UNVERIFIED_ID, DIGEST, third.questionId)).rejects.toThrow();
  });
});

describe('a startup resume', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'agent-unverified-startup-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function startWith(createChannel: ReturnType<typeof vi.fn>, acceptedDigest?: string) {
    return render(
      <App
        cwd={cwd}
        createChannel={createChannel}
        resumeSessionId={UNVERIFIED_ID}
        {...(acceptedDigest === undefined ? {} : { acceptedDigest })}
        cliAdapter={cliAdapter(join(cwd, 'settings.json'))}
      />,
    );
  }

  it('opens the first channel with the digest the product shell was handed', () => {
    const createChannel = vi.fn(() => fakeChannel());
    startWith(createChannel, DIGEST).unmount();

    expect(createChannel).toHaveBeenCalledTimes(1);
    expect(createChannel).toHaveBeenNthCalledWith(1, UNVERIFIED_ID, DIGEST);
  });

  it('opens it with only the id when there is none', () => {
    const createChannel = vi.fn(() => fakeChannel());
    startWith(createChannel).unmount();

    expect(createChannel.mock.calls[0]).toEqual([UNVERIFIED_ID]);
  });
});
