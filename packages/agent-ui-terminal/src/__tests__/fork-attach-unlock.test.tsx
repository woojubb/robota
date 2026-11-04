/**
 * #3679 3f: attaching to a fork whose record is sealed with the keys locked is a read the person
 * started, so it asks for the passphrase — once, through the keys' holder — and attaches when that
 * unlocks. Without a holder (secure mode off) it reads the store exactly as before and never asks.
 */
import { withHoldReadClaim } from '@robota-sdk/agent-interface-session/testing';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useForkAttach } from '../hooks/useForkAttach.js';
import { TuiCliAdapterProvider } from '../tui-cli-adapter-context.js';

import type {
  IKeyCustodyPort,
  TReadability,
  TUserReadRequest,
} from '../key-custody/key-custody-port.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type {
  IInteractiveSessionStore,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

const FORK = 'session_fork';

const READABLE: TSessionLoadOutcome = {
  status: 'valid',
  record: {
    id: FORK,
    cwd: '/work',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    messages: [],
  },
};

/** A store whose fork record is locked until `open()`, recording every call made to it. */
function storeOf(outcome: () => TSessionLoadOutcome) {
  const calls: string[] = [];
  const store: Omit<IInteractiveSessionStore, 'claim' | 'lend' | 'hasWriter'> = {
    list: () => [],
    load: (id) => {
      calls.push(`load:${id}`);
      return outcome();
    },
    save: () => undefined,
    delete: () => undefined,
  };
  return { store: withHoldReadClaim(store), calls };
}

function forkEntry(): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    taskKind: 'agent',
    origin: { kind: 'slash_command', sessionId: 'session_parent' },
    status: 'running',
    state: 'working',
    title: 'experiment',
    subtitle: 'general-purpose',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-09-07T00:00:00.000Z',
    controls: ['select', 'cancel', 'attach'],
    resumeSessionId: FORK,
  };
}

function custody(answer: TReadability, onAsk: () => void = () => undefined) {
  const ensureReadable = vi.fn(async (_request: TUserReadRequest) => {
    onAsk();
    return answer;
  });
  return { port: { ensureReadable } satisfies IKeyCustodyPort, ensureReadable };
}

function attachWith(store: IInteractiveSessionStore, keyCustody?: IKeyCustodyPort) {
  const addEntry = vi.fn();
  const onSessionSwitch = vi.fn();
  let attach!: (entry: IExecutionWorkspaceEntry) => void;
  function Probe(): React.ReactElement {
    attach = useForkAttach({ sessionStore: store, onSessionSwitch, addEntry });
    return <></>;
  }
  const adapter = (keyCustody === undefined ? {} : { keyCustody }) as ITuiCliAdapter;
  const view = render(
    <TuiCliAdapterProvider value={adapter}>
      <Probe />
    </TuiCliAdapterProvider>,
  );
  return {
    attach: (entry: IExecutionWorkspaceEntry) => attach(entry),
    said: () => addEntry.mock.calls.map(([entry]) => JSON.stringify(entry)).join('\n'),
    addEntry,
    onSessionSwitch,
    done: () => view.unmount(),
  };
}

describe('attaching to a fork sealed with the keys locked', () => {
  it('asks once to continue the fork, and attaches when that unlocks it', async () => {
    let unlocked = false;
    const { store } = storeOf(() => (unlocked ? READABLE : { status: 'locked' }));
    const keys = custody('readable', () => {
      unlocked = true;
    });
    const probe = attachWith(store, keys.port);

    probe.attach(forkEntry());
    await vi.waitFor(() => expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK));
    probe.done();

    expect(keys.ensureReadable).toHaveBeenCalledTimes(1);
    expect(keys.ensureReadable.mock.calls[0]?.[0]).toMatchObject({ purpose: 'continue-fork' });
    expect(probe.addEntry).not.toHaveBeenCalled();
  });

  it('does not attach when the unlock is declined or cannot be asked, and names /unlock', async () => {
    for (const answer of ['declined', 'unavailable'] as const) {
      const { store } = storeOf(() => ({ status: 'locked' }));
      const probe = attachWith(store, custody(answer).port);

      probe.attach(forkEntry());
      await vi.waitFor(() => expect(probe.addEntry).toHaveBeenCalled());
      probe.done();

      expect(probe.onSessionSwitch, answer).not.toHaveBeenCalled();
      expect(probe.said(), answer).toContain(`Session ${FORK} is sealed and locked`);
      expect(probe.said(), answer).toContain('/unlock');
    }
  });

  it('asks nothing when attach would be refused anyway, and says why', async () => {
    const { store } = storeOf(() => ({ status: 'locked' }));
    // A job still writing the fork's record: attach would add a second writer.
    store.claim(FORK);
    const keys = custody('readable');
    const probe = attachWith(store, keys.port);

    probe.attach(forkEntry());
    await vi.waitFor(() => expect(probe.addEntry).toHaveBeenCalled());
    probe.done();

    expect(keys.ensureReadable).not.toHaveBeenCalled();
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    expect(probe.said()).toContain('already has a writer');
  });

  it('asks nothing for a fork sealed with keys this process does not have', async () => {
    const { store } = storeOf(() => ({ status: 'locked', reason: 'no-keys' }));
    const keys = custody('readable');
    const probe = attachWith(store, keys.port);

    probe.attach(forkEntry());
    await vi.waitFor(() => expect(probe.addEntry).toHaveBeenCalled());
    probe.done();

    expect(keys.ensureReadable).not.toHaveBeenCalled();
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
  });
});

describe('attaching with secure mode off', () => {
  it('reads the store exactly as it always has, and switches at once', () => {
    const { store, calls } = storeOf(() => READABLE);
    const probe = attachWith(store);

    probe.attach(forkEntry());
    probe.done();

    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK);
    // The lock probe, then the presence check: the two reads attach has always made.
    expect(calls).toEqual([`load:${FORK}`, `load:${FORK}`]);
  });
});
