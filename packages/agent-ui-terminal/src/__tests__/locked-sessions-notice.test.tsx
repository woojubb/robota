/**
 * The terminal and sealed sessions whose keys are locked. They are not in the resume picker (there
 * is no record to show), so an empty picker must not read as "nothing saved"; and attaching to a fork
 * that was written sealed must not report it as gone.
 */

import { withHoldReadClaim } from '@robota-sdk/agent-interface-session/testing';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useAppOverlays } from '../hooks/useAppOverlays.js';
import { useForkAttach } from '../hooks/useForkAttach.js';
import { TuiCliAdapterProvider } from '../tui-cli-adapter-context.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type {
  IInteractiveSessionStore,
  ISessionListEntry,
  ISessionListingEntry,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

function storeOf(
  load: (id: string) => TSessionLoadOutcome,
  locked?: number,
  entries: readonly ISessionListEntry[] = [],
): IInteractiveSessionStore & { readonly reads: { count: number } } {
  const reads = { count: 0 };
  const store: Omit<IInteractiveSessionStore, 'claim' | 'lend' | 'hasWriter'> & {
    readonly reads: { count: number };
  } = {
    reads,
    list: () => {
      reads.count += 1;
      return entries;
    },
    load,
    save: () => undefined,
    delete: () => undefined,
    ...(locked === undefined
      ? {}
      : {
          scan: () => {
            reads.count += 1;
            return { entries, locked };
          },
        }),
  };
  return withHoldReadClaim(store);
}

const READABLE: ISessionListEntry = {
  id: 'sess_readable',
  outcome: {
    status: 'valid',
    record: {
      id: 'sess_readable',
      cwd: '/work',
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
      messages: [],
    },
  },
};

const NOTHING = 'No saved sessions to resume in this workspace.';

function PickerProbe(props: {
  readonly store: IInteractiveSessionStore;
  readonly hostSessions?: readonly ISessionListingEntry[];
  readonly hostLockedSessionCount?: number;
  readonly addEntry: (entry: IHistoryEntry) => void;
  readonly setSessionPickerVisible: (visible: boolean) => void;
}): React.ReactElement {
  useAppOverlays({
    cwd: '/work',
    pluginAdapter: undefined,
    pluginVisible: false,
    setPluginVisible: () => undefined,
    transportRegistry: undefined,
    transportVisible: false,
    setTransportVisible: () => undefined,
    sessionStore: props.store,
    hostSessions: props.hostSessions,
    hostLockedSessionCount: props.hostLockedSessionCount ?? 0,
    sessionPickerVisible: true,
    setSessionPickerVisible: props.setSessionPickerVisible,
    onSessionSwitch: async () => undefined,
    addEntry: props.addEntry,
  });
  return <></>;
}

async function pickerNotices(
  store: IInteractiveSessionStore,
  hostSessions?: readonly ISessionListingEntry[],
  hostLockedSessionCount?: number,
  adapter?: ITuiCliAdapter,
): Promise<string[]> {
  const addEntry = vi.fn();
  const setSessionPickerVisible = vi.fn();
  const probe = (
    <PickerProbe
      store={store}
      hostSessions={hostSessions}
      hostLockedSessionCount={hostLockedSessionCount}
      addEntry={addEntry}
      setSessionPickerVisible={setSessionPickerVisible}
    />
  );
  const view = render(
    adapter === undefined ? (
      probe
    ) : (
      <TuiCliAdapterProvider value={adapter}>{probe}</TuiCliAdapterProvider>
    ),
  );
  await vi.waitFor(() => expect(addEntry).toHaveBeenCalled());
  view.unmount();
  expect(setSessionPickerVisible).toHaveBeenCalledWith(false);
  return addEntry.mock.calls.map(([entry]) => JSON.stringify(entry));
}

describe('the resume picker with sealed sessions', () => {
  it('says sealed sessions are locked when the picker would otherwise read as empty', async () => {
    const notices = await pickerNotices(storeOf(() => ({ status: 'missing' }), 3));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(
      `${NOTHING} 3 saved sessions are sealed and locked; unlock to open them.`,
    );
  });

  it('names /unlock where this terminal holds the keys to unlock', async () => {
    const keyCustody = { ensureReadable: async () => 'readable' as const };
    const [notice] = await pickerNotices(
      storeOf(() => ({ status: 'missing' }), 3),
      undefined,
      undefined,
      { keyCustody } as unknown as ITuiCliAdapter,
    );
    expect(notice).toContain(
      `${NOTHING} 3 saved sessions are sealed and locked; run \`/unlock\` to open them.`,
    );
  });

  it('uses the singular for one', async () => {
    const [notice] = await pickerNotices(storeOf(() => ({ status: 'missing' }), 1));
    expect(notice).toContain(`${NOTHING} 1 saved session is sealed and locked; unlock to open it.`);
  });

  it('is the plain notice when nothing is sealed, and when the store cannot count', async () => {
    const [none] = await pickerNotices(storeOf(() => ({ status: 'missing' }), 0));
    const [cannotCount] = await pickerNotices(storeOf(() => ({ status: 'missing' })));
    for (const notice of [none, cannotCount]) {
      expect(notice).toContain(NOTHING);
      expect(notice).not.toContain('sealed');
    }
  });

  it('says sealed sessions are locked even when there are readable sessions to pick from', async () => {
    const addEntry = vi.fn();
    const setSessionPickerVisible = vi.fn();
    const view = render(
      <PickerProbe
        store={storeOf(() => ({ status: 'missing' }), 2, [READABLE])}
        addEntry={addEntry}
        setSessionPickerVisible={setSessionPickerVisible}
      />,
    );
    await vi.waitFor(() => expect(addEntry).toHaveBeenCalled());
    view.unmount();

    const notices = addEntry.mock.calls.map(([entry]) => JSON.stringify(entry));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('2 saved sessions are sealed and locked; unlock to open them.');
    expect(notices[0]).not.toContain(NOTHING);
    expect(setSessionPickerVisible).not.toHaveBeenCalledWith(false);
  });

  it('reads the store once while the picker is open, not on every render', async () => {
    const store = storeOf(() => ({ status: 'missing' }), 1, [READABLE]);
    const props = { store, addEntry: vi.fn(), setSessionPickerVisible: vi.fn() };
    const view = render(<PickerProbe {...props} />);
    for (let index = 0; index < 4; index += 1) view.rerender(<PickerProbe {...props} />);
    view.unmount();

    expect(store.reads.count).toBe(1);
  });

  it("does not count the local store's sealed sessions when the host keeps the sessions", async () => {
    const [notice] = await pickerNotices(
      storeOf(() => ({ status: 'missing' }), 5),
      [],
    );
    expect(notice).toContain(NOTHING);
    expect(notice).not.toContain('sealed');
  });

  it("says the host's count of sealed sessions when the host keeps the sessions, never to unlock", async () => {
    const [notice] = await pickerNotices(
      storeOf(() => ({ status: 'missing' }), 5),
      [],
      2,
    );
    // The host's count holds sessions its keys do not open as well as locked ones, and which is
    // which does not cross the wire.
    expect(notice).toContain(`${NOTHING} 2 saved sessions are sealed and not listed here.`);
    expect(notice).not.toMatch(/unlock/i);
  });
});

function forkEntry(resumeSessionId: string | undefined): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    taskKind: 'agent',
    origin: { kind: 'slash_command', sessionId: 'session_parent' },
    status: 'completed',
    state: 'completed',
    title: 'experiment',
    subtitle: 'general-purpose',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-09-07T00:00:00.000Z',
    controls: ['select', 'cancel', 'attach'],
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
  };
}

function attachWith(store: IInteractiveSessionStore) {
  const addEntry = vi.fn();
  const onSessionSwitch = vi.fn();
  let attach!: (entry: IExecutionWorkspaceEntry) => void;
  function Probe(): React.ReactElement {
    attach = useForkAttach({ sessionStore: store, onSessionSwitch, select: vi.fn(), addEntry });
    return <></>;
  }
  const view = render(
    <TuiCliAdapterProvider value={{} as ITuiCliAdapter}>
      <Probe />
    </TuiCliAdapterProvider>,
  );
  return {
    attach: (entry: IExecutionWorkspaceEntry) => attach(entry),
    addEntry,
    onSessionSwitch,
    done: () => view.unmount(),
  };
}

describe('attaching to a fork that was written sealed', () => {
  it('names the lock instead of saying the fork is gone, and does not switch', () => {
    const probe = attachWith(storeOf(() => ({ status: 'locked' })));
    probe.attach(forkEntry('session_fork'));
    probe.done();

    expect(probe.onSessionSwitch).not.toHaveBeenCalled();
    const said = probe.addEntry.mock.calls.map(([entry]) => JSON.stringify(entry)).join('\n');
    expect(said).toContain('Session session_fork is sealed and locked; unlock to open it.');
    expect(said).not.toContain('no longer in the session store');
  });

  it('still switches when the fork record is readable, and still says gone when it is missing', () => {
    const readable = attachWith(
      storeOf(() => ({
        status: 'valid',
        record: {
          id: 'session_fork',
          cwd: '/work',
          createdAt: '2026-09-07T00:00:00.000Z',
          updatedAt: '2026-09-07T00:00:00.000Z',
          messages: [],
        },
      })),
    );
    readable.attach(forkEntry('session_fork'));
    readable.done();
    expect(readable.onSessionSwitch).toHaveBeenCalledWith('session_fork');

    const gone = attachWith(storeOf(() => ({ status: 'missing' })));
    gone.attach(forkEntry('session_fork'));
    gone.done();
    expect(gone.onSessionSwitch).not.toHaveBeenCalled();
    expect(JSON.stringify(gone.addEntry.mock.calls)).toContain('no longer in the session store');
  });
});
