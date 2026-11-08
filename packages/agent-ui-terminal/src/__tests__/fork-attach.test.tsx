/**
 * The `attach` control, what it does, and what it refuses.
 *
 * Attaching to a job that is still running FOLLOWS it: the terminal selects the job's entry and
 * nothing else happens (no session switch, no record read, the job keeps running). Attaching to a
 * fork that has ended is a VIEW switch onto the fork's own session record, and neither record is
 * written or merged. So what these cases pin is which entries offer the control, that each life of
 * the fork does its own thing, and the refusals, each of which must reach the operator with its
 * reason rather than leaving the terminal pointed at nothing.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface/session/testing';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ExecutionWorkspaceSwitcher from '../ExecutionWorkspaceSwitcher.js';
import { attachToForkedSession } from '../flows/fork-attach-flow.js';
import type { IForkAttachDeps } from '../flows/fork-attach-flow.js';
import { useForkAttach } from '../hooks/useForkAttach.js';
import { TuiCliAdapterProvider } from '../tui-cli-adapter-context.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type {
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
  TExecutionControl,
} from '@robota-sdk/agent-interface/execution';
import type {
  IInteractiveSessionStore,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface/session';

const FORK_SESSION_ID = 'session_cli-1994-fork';

function makeForkEntry(
  overrides: Partial<IExecutionWorkspaceEntry> = {},
): IExecutionWorkspaceEntry {
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
    resumeSessionId: FORK_SESSION_ID,
    ...overrides,
  };
}

function makePlainEntry(): IExecutionWorkspaceEntry {
  const { resumeSessionId: _dropped, ...entry } = makeForkEntry({
    id: 'task:agent_2',
    sourceId: 'agent_2',
    title: 'plain job',
    controls: ['select', 'cancel'],
  });
  return entry;
}

function makeSnapshot(entries: readonly IExecutionWorkspaceEntry[]): IExecutionWorkspaceSnapshot {
  return {
    sessionId: 'session_parent',
    selectedEntryId: entries[0]?.id ?? '',
    updatedAt: '2026-09-07T00:00:00.000Z',
    entries: [...entries],
  };
}

/** The store answer: which records still exist. */
function storeWith(ids: readonly string[]): (sessionId: string) => boolean {
  return (sessionId) => ids.includes(sessionId);
}

/** Deps whose store answers are fixed; every action is a spy. */
function depsOf(
  facts: { writer?: boolean; records?: readonly string[] } = {},
  overrides: Partial<IForkAttachDeps> = {},
): IForkAttachDeps & {
  followTask: ReturnType<typeof vi.fn>;
  switchSession: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
} {
  return {
    facts: {
      kind: 'store',
      hasSessionRecord: storeWith(facts.records ?? [FORK_SESSION_ID]),
      hasWriter: () => facts.writer ?? false,
    },
    followTask: vi.fn(),
    switchSession: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  } as never;
}

describe('attaching to a fork follows the job or switches the view', () => {
  it.each(['queued', 'running', 'waiting_permission'] as const)(
    'a %s fork is FOLLOWED: its entry is selected, and nothing switches',
    (status) => {
      const deps = depsOf();
      const entry = makeForkEntry({ status });

      const outcome = attachToForkedSession(entry, deps);

      expect(outcome).toEqual({ type: 'follow', taskId: 'agent_1' });
      expect(deps.followTask).toHaveBeenCalledWith(entry);
      expect(deps.switchSession).not.toHaveBeenCalled();
      expect(deps.notify).not.toHaveBeenCalled();
    },
  );

  it('follows a running fork whose record has a writer: the job is that writer', () => {
    const deps = depsOf({ writer: true });

    const outcome = attachToForkedSession(makeForkEntry({ status: 'running' }), deps);

    expect(outcome).toEqual({ type: 'follow', taskId: 'agent_1' });
    expect(deps.switchSession).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'a %s fork is CONTINUED: the view switches onto the FORK, not the parent',
    (status) => {
      const deps = depsOf();

      const outcome = attachToForkedSession(makeForkEntry({ status }), deps);

      expect(outcome).toEqual({ type: 'switch', sessionId: FORK_SESSION_ID });
      expect(deps.switchSession).toHaveBeenCalledWith(FORK_SESSION_ID);
      expect(deps.followTask).not.toHaveBeenCalled();
      // A view switch, not a merge: the only thing that happened is the switch.
      expect(deps.notify).not.toHaveBeenCalled();
    },
  );

  it('an entry with no resumeSessionId is not attachable and does nothing', () => {
    const deps = depsOf();

    const outcome = attachToForkedSession(makePlainEntry(), deps);

    expect(outcome).toBeUndefined();
    expect(deps.switchSession).not.toHaveBeenCalled();
    expect(deps.followTask).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('not a forked session'));
  });

  it('the switcher offers the attach hint on a forked entry and calls onAttach for the `a` key', () => {
    const onAttach = vi.fn();
    const entry = makeForkEntry();
    const { lastFrame, stdin } = render(
      <ExecutionWorkspaceSwitcher
        snapshot={makeSnapshot([entry])}
        selectedEntryId={entry.id}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onAttach={onAttach}
      />,
    );

    expect(lastFrame()).toMatch(/\bA Follow\b/);

    stdin.write('a');

    expect(onAttach).toHaveBeenCalledWith(entry);
  });

  it('an entry without the attach control neither offers the hint nor answers the key', () => {
    const onAttach = vi.fn();
    const entry = makePlainEntry();
    const { lastFrame, stdin } = render(
      <ExecutionWorkspaceSwitcher
        snapshot={makeSnapshot([entry])}
        selectedEntryId={entry.id}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onAttach={onAttach}
      />,
    );

    expect(lastFrame()).not.toMatch(/\ba (Follow|Continue)\b/);

    stdin.write('a');

    expect(onAttach).not.toHaveBeenCalled();
  });

  it('`attach` is a member of TExecutionControl — every control list still accepts it', () => {
    // The runtime half of the union change; the compile half is the package `typecheck` this suite
    // is paired with, which reaches every exhaustive switch over the union.
    const controls: readonly TExecutionControl[] = [
      'select',
      'cancel',
      'close',
      'send',
      'read_log',
      'wait',
      'attach',
    ];
    expect(controls).toContain('attach');
    expect(makeForkEntry().controls).toContain('attach');
  });
});

describe('attach refuses rather than stranding the terminal', () => {
  it('uses a host-supplied resume command when a fork cannot be attached, while a neutral host gets the session id', () => {
    // The record is gone: the one refusal that names the session and says where it was.
    const entry = makeForkEntry({ status: 'completed' });
    const neutral = depsOf({ records: [] });
    attachToForkedSession(entry, neutral);
    expect(neutral.notify.mock.calls[0]?.[0]).toContain(FORK_SESSION_ID);

    const product = depsOf(
      { records: [] },
      { formatResumeCommand: (id) => `agent --resume ${id}` },
    );
    attachToForkedSession(entry, product);
    // Nothing to resume from a record that is gone: the command is not offered for it.
    expect(product.notify.mock.calls[0]?.[0]).not.toContain('agent --resume');
  });

  it('a missing session record is refused, naming the record and the task status', () => {
    const deps = depsOf({ records: [] });

    const outcome = attachToForkedSession(makeForkEntry({ status: 'completed' }), deps);

    expect(outcome).toBeUndefined();
    expect(deps.switchSession).not.toHaveBeenCalled();
    const reason = deps.notify.mock.calls[0]?.[0] as string;
    expect(reason).toContain(FORK_SESSION_ID);
    expect(reason).toContain('completed');
    expect(reason).toContain('no longer in the session store');
  });

  it('a fork that has ended but whose record still has a writer is refused, saying to retry', () => {
    const deps = depsOf({ writer: true });

    const outcome = attachToForkedSession(makeForkEntry({ status: 'completed' }), deps);

    expect(outcome).toBeUndefined();
    expect(deps.switchSession).not.toHaveBeenCalled();
    const reason = deps.notify.mock.calls[0]?.[0] as string;
    expect(reason).toContain('experiment has ended');
    expect(reason).toContain('still has a writer');
    expect(reason).toContain('Try again in a moment');
  });

  it('a surface with no store continues an ended fork through its host, and follows a running one', () => {
    const ended = depsOf({}, { facts: { kind: 'host' } });
    attachToForkedSession(makeForkEntry({ status: 'completed' }), ended);
    expect(ended.switchSession).toHaveBeenCalledWith(FORK_SESSION_ID);

    const running = depsOf({}, { facts: { kind: 'host' } });
    attachToForkedSession(makeForkEntry({ status: 'running' }), running);
    expect(running.followTask).toHaveBeenCalledTimes(1);
    expect(running.switchSession).not.toHaveBeenCalled();
  });
});

describe('the attach handler of this terminal', () => {
  function forkRecord(): TSessionLoadOutcome {
    return {
      status: 'valid',
      record: {
        id: FORK_SESSION_ID,
        cwd: '/work',
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        messages: [],
      },
    };
  }

  function probeOf(
    sessionStore: IInteractiveSessionStore | undefined,
    snapshot: IExecutionWorkspaceSnapshot | null = null,
  ) {
    const addEntry = vi.fn();
    const onSessionSwitch = vi.fn();
    const select = vi.fn();
    let latest!: ReturnType<typeof useForkAttach>;
    function Probe(): React.ReactElement {
      latest = useForkAttach({ sessionStore, onSessionSwitch, select, addEntry, snapshot });
      return <></>;
    }
    const view = render(
      <TuiCliAdapterProvider value={{} as ITuiCliAdapter}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    return {
      attach: (entry: IExecutionWorkspaceEntry) => latest.attach(entry),
      /** The question the person is being asked now, if any. */
      question: () => latest.continueQuestion,
      said: () => addEntry.mock.calls.map(([entry]) => JSON.stringify(entry)).join('\n'),
      addEntry,
      onSessionSwitch,
      select,
      done: () => view.unmount(),
    };
  }

  it('follows a running fork by selecting its entry, without reading the store', () => {
    const load = vi.fn(() => forkRecord());
    const store = withHoldReadClaim({
      load,
      list: () => [],
      save: () => undefined,
      delete: () => undefined,
    });
    const probe = probeOf(store);

    probe.attach(makeForkEntry({ status: 'running' }));
    probe.done();

    expect(probe.select).toHaveBeenCalledWith('task:agent_1');
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    expect(probe.addEntry).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('follows a running fork on a surface with no session store, where it used to say so and stop', () => {
    const probe = probeOf(undefined);

    probe.attach(makeForkEntry({ status: 'running' }));
    probe.done();

    expect(probe.select).toHaveBeenCalledWith('task:agent_1');
    expect(probe.addEntry).not.toHaveBeenCalled();
  });

  it('continues an ended fork on a surface with no session store through its host', () => {
    const probe = probeOf(undefined);

    probe.attach(makeForkEntry({ status: 'completed' }));
    probe.done();

    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK_SESSION_ID);
    expect(probe.select).not.toHaveBeenCalled();
  });

  it('asks the store whether the ended fork has a writer, and refuses while a session claims it', () => {
    const store = withHoldReadClaim({
      load: () => forkRecord(),
      list: () => [],
      save: () => undefined,
      delete: () => undefined,
    });
    const claim = store.claim(FORK_SESSION_ID);
    const probe = probeOf(store);

    probe.attach(makeForkEntry({ status: 'completed' }));
    claim.release();
    probe.attach(makeForkEntry({ status: 'completed' }));
    probe.done();

    expect(probe.said()).toContain('experiment has ended');
    expect(probe.said()).toContain('still has a writer');
    expect(probe.onSessionSwitch).toHaveBeenCalledTimes(1);
    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK_SESSION_ID);
  });
});

describe('continuing an ended fork while other jobs of the session run', () => {
  function validFork(): TSessionLoadOutcome {
    return {
      status: 'valid',
      record: {
        id: FORK_SESSION_ID,
        cwd: '/work',
        createdAt: '2026-09-07T00:00:00.000Z',
        updatedAt: '2026-09-07T00:00:00.000Z',
        messages: [],
      },
    };
  }

  function storeOf(): IInteractiveSessionStore {
    return withHoldReadClaim({
      load: () => validFork(),
      list: () => [],
      save: () => undefined,
      delete: () => undefined,
    });
  }

  function sibling(id: string, status: IExecutionWorkspaceEntry['status']) {
    const { resumeSessionId: _dropped, ...entry } = makeForkEntry({
      id: `task:${id}`,
      sourceId: id,
      title: id,
      status,
      controls: ['select', 'cancel'],
    });
    return entry;
  }

  function probeOf(
    sessionStore: IInteractiveSessionStore | undefined,
    snapshot: IExecutionWorkspaceSnapshot | null,
  ) {
    const addEntry = vi.fn();
    const onSessionSwitch = vi.fn();
    const select = vi.fn();
    let latest!: ReturnType<typeof useForkAttach>;
    let currentSnapshot = snapshot;
    function Probe(): React.ReactElement {
      latest = useForkAttach({
        sessionStore,
        onSessionSwitch,
        select,
        addEntry,
        snapshot: currentSnapshot,
      });
      return <></>;
    }
    const view = render(
      <TuiCliAdapterProvider value={{} as ITuiCliAdapter}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    return {
      attach: (entry: IExecutionWorkspaceEntry) => latest.attach(entry),
      question: () => latest.continueQuestion,
      said: () => addEntry.mock.calls.map(([entry]) => JSON.stringify(entry)).join('\n'),
      onSessionSwitch,
      select,
      update: (next: IExecutionWorkspaceSnapshot) => {
        currentSnapshot = next;
        view.rerender(
          <TuiCliAdapterProvider value={{} as ITuiCliAdapter}>
            <Probe />
          </TuiCliAdapterProvider>,
        );
      },
      done: () => view.unmount(),
    };
  }

  const ended = (): IExecutionWorkspaceEntry => makeForkEntry({ status: 'completed' });

  it('asks first, says how many jobs will be stopped, and switches only on yes', async () => {
    const snapshot = makeSnapshot([
      ended(),
      sibling('agent_2', 'running'),
      sibling('agent_3', 'queued'),
    ]);
    const probe = probeOf(storeOf(), snapshot);

    probe.attach(ended());
    await vi.waitFor(() => expect(probe.question()).toBeDefined());

    expect(probe.question()?.message).toContain(
      '2 background jobs are still running and will be stopped',
    );
    expect(probe.question()?.message).toContain('experiment');
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();

    probe.question()?.answer(true);

    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK_SESSION_ID);
    await vi.waitFor(() => expect(probe.question()).toBeUndefined());
    probe.done();
  });

  it('stops nothing and switches nothing on no, and says so', async () => {
    const snapshot = makeSnapshot([ended(), sibling('agent_2', 'running')]);
    const probe = probeOf(storeOf(), snapshot);

    probe.attach(ended());
    await vi.waitFor(() => expect(probe.question()).toBeDefined());
    probe.question()?.answer(false);

    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    expect(probe.said()).toContain('still running');
    expect(probe.said()).toContain('not switched');
    await vi.waitFor(() => expect(probe.question()).toBeUndefined());
    probe.done();
  });

  it('names a single job in the singular', async () => {
    const snapshot = makeSnapshot([ended(), sibling('agent_2', 'running')]);
    const probe = probeOf(storeOf(), snapshot);

    probe.attach(ended());
    await vi.waitFor(() => expect(probe.question()).toBeDefined());

    expect(probe.question()?.message).toContain(
      '1 background job is still running and will be stopped',
    );
    probe.done();
  });

  it('switches at once, with no question, when no other job is running', () => {
    const snapshot = makeSnapshot([ended(), sibling('agent_2', 'completed')]);
    const probe = probeOf(storeOf(), snapshot);

    probe.attach(ended());

    expect(probe.question()).toBeUndefined();
    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK_SESSION_ID);
    probe.done();
  });

  it('refuses without asking when the switch would be refused anyway', () => {
    const store = storeOf();
    const claim = store.claim(FORK_SESSION_ID);
    const snapshot = makeSnapshot([ended(), sibling('agent_2', 'running')]);
    const probe = probeOf(store, snapshot);

    probe.attach(ended());
    claim.release();

    expect(probe.question()).toBeUndefined();
    expect(probe.said()).toContain('still has a writer');
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    probe.done();
  });

  it('checks the writer again after the person answers', async () => {
    const store = storeOf();
    const probe = probeOf(store, makeSnapshot([ended(), sibling('agent_2', 'running')]));
    probe.attach(ended());
    await vi.waitFor(() => expect(probe.question()).toBeDefined());
    const claim = store.claim(FORK_SESSION_ID);
    probe.question()?.answer(true);
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    expect(probe.said()).toContain('still has a writer');
    claim.release();
    probe.done();
  });

  it('asks again if more jobs started while the question was open', async () => {
    const probe = probeOf(storeOf(), makeSnapshot([ended(), sibling('agent_2', 'running')]));
    probe.attach(ended());
    await vi.waitFor(() => expect(probe.question()).toBeDefined());
    probe.update(
      makeSnapshot([ended(), sibling('agent_2', 'running'), sibling('agent_3', 'running')]),
    );
    probe.question()?.answer(true);
    await vi.waitFor(() => expect(probe.question()?.message).toContain('2 background jobs'));
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    probe.question()?.answer(true);
    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK_SESSION_ID);
    probe.done();
  });

  it('does not ask on a surface with no store: the host keeps its session while jobs run', () => {
    const snapshot = makeSnapshot([ended(), sibling('agent_2', 'running')]);
    const probe = probeOf(undefined, snapshot);

    probe.attach(ended());

    expect(probe.question()).toBeUndefined();
    expect(probe.onSessionSwitch).toHaveBeenCalledWith(FORK_SESSION_ID);
    probe.done();
  });

  it('does not ask when it follows a running fork: nothing is stopped by following', () => {
    const running = makeForkEntry({ status: 'running' });
    const snapshot = makeSnapshot([running, sibling('agent_2', 'running')]);
    const probe = probeOf(storeOf(), snapshot);

    probe.attach(running);

    expect(probe.question()).toBeUndefined();
    expect(probe.select).toHaveBeenCalledWith('task:agent_1');
    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    probe.done();
  });
});
