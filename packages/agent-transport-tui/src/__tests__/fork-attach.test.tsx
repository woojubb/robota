/**
 * CLI-1994 TC-08 / TC-09 — the `attach` control, and what it refuses.
 *
 * Attach is the only genuinely new user surface this item adds, and the whole of its meaning is that
 * it is a VIEW switch: the terminal starts looking at the fork's own session record, and neither
 * record is written or merged. So what these cases pin is the pair — which entries offer the
 * control, and that selecting it produces the command layer's `switch-session` intent for the
 * FORK's id — plus the three refusals, each of which must reach the operator with its reason rather
 * than leaving the terminal pointed at nothing.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ExecutionWorkspaceSwitcher, {
  EXECUTION_WORKSPACE_ATTACH_HINT,
} from '../ExecutionWorkspaceSwitcher.js';
import { attachToForkedSession } from '../flows/fork-attach-flow.js';

import type {
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
  TExecutionControl,
} from '@robota-sdk/agent-interface-execution';

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

describe('attaching to a fork switches the view (CLI-1994 TC-08)', () => {
  it('a forked entry produces a switch-session intent for the FORK, not the parent', () => {
    const switchSession = vi.fn();
    const notify = vi.fn();

    const intent = attachToForkedSession(makeForkEntry(), {
      hasSessionRecord: storeWith([FORK_SESSION_ID]),
      switchSession,
      notify,
    });

    expect(intent).toEqual({ type: 'switch-session', sessionId: FORK_SESSION_ID });
    expect(switchSession).toHaveBeenCalledWith(FORK_SESSION_ID);
    // A view switch, not a merge: the only thing that happened is the switch.
    expect(notify).not.toHaveBeenCalled();
  });

  it('an entry with no resumeSessionId is not attachable and emits no intent', () => {
    const switchSession = vi.fn();
    const notify = vi.fn();

    const intent = attachToForkedSession(makePlainEntry(), {
      hasSessionRecord: storeWith([FORK_SESSION_ID]),
      switchSession,
      notify,
    });

    expect(intent).toBeUndefined();
    expect(switchSession).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('not a forked session'));
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

    expect(lastFrame()).toContain(EXECUTION_WORKSPACE_ATTACH_HINT.label);

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

    expect(lastFrame()).not.toContain(EXECUTION_WORKSPACE_ATTACH_HINT.label);

    stdin.write('a');

    expect(onAttach).not.toHaveBeenCalled();
  });

  it('`attach` is a member of TExecutionControl — every control list still accepts it', () => {
    // The runtime half of the union change; the compile half is the package `typecheck` this suite
    // is paired with in the spec's TC-08, which reaches every exhaustive switch over the union.
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

describe('attach refuses rather than stranding the terminal (CLI-1994 TC-09)', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)(
    'a %s fork is refused with its status, and no intent is emitted',
    (status) => {
      const switchSession = vi.fn();
      const notify = vi.fn();

      const intent = attachToForkedSession(makeForkEntry({ status }), {
        // The record is still there; the TASK being terminal is what refuses.
        hasSessionRecord: storeWith([FORK_SESSION_ID]),
        switchSession,
        notify,
      });

      expect(intent).toBeUndefined();
      expect(switchSession).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.stringContaining(status));
    },
  );

  it('a missing session record is refused, naming the record and the task status', () => {
    const switchSession = vi.fn();
    const notify = vi.fn();

    const intent = attachToForkedSession(makeForkEntry({ status: 'running' }), {
      hasSessionRecord: storeWith([]),
      switchSession,
      notify,
    });

    expect(intent).toBeUndefined();
    expect(switchSession).not.toHaveBeenCalled();
    const reason = notify.mock.calls[0]?.[0] as string;
    expect(reason).toContain(FORK_SESSION_ID);
    expect(reason).toContain('running');
    expect(reason).toContain('no longer in the session store');
  });

  it('a running fork whose record exists is the ONLY case that switches', () => {
    const switchSession = vi.fn();

    attachToForkedSession(makeForkEntry({ status: 'waiting_permission' }), {
      hasSessionRecord: storeWith([FORK_SESSION_ID]),
      switchSession,
      notify: vi.fn(),
    });

    expect(switchSession).toHaveBeenCalledTimes(1);
  });
});
