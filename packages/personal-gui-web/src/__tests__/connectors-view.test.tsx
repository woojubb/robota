// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_WRITE_HEADER, ApiError, createPersonalApi } from '../api.js';
import { ConnectorsView } from '../views/Connectors.js';

import type {
  IConnectorCatalogView,
  IConnectorView,
  IConnectorsListing,
  IPersonalApi,
} from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DEFAULT_WORDS =
  'Ask me about anything that needs my decision soon or looks unusual; do not ask me about routine updates.';

const NOTES: IConnectorView = {
  id: 'connector-notes-1',
  title: 'Notes',
  kind: 'notes',
  endpoint: 'https://notes.example/mcp',
  defaultAttention: DEFAULT_WORDS,
  status: { state: 'connected', scope: 'notes.read notes.write' },
  tools: [
    { name: 'search_notes', description: 'Find notes', access: 'read', hints: { readOnly: true } },
    { name: 'create_note', access: 'write' },
    { name: 'delete_note', access: 'blocked', decision: 'blocked' },
  ],
};

function fakeApi(
  connectors: readonly IConnectorView[],
  extra: Partial<IPersonalApi> = {},
): IPersonalApi {
  const listing: IConnectorsListing = { callbackPath: '/connector-callback', connectors };
  return {
    connectors: async () => listing,
    connectorPulled: async () => ({ count: 0 }),
    fenceCaseActionRequests: async () => ({
      fenced: [NOTES.id, 'other', ...connectors.map((connector) => connector.id)],
      callbackPath: '/connector-callback',
      connectors,
    }),
    openConnectorCaseActions: async () => {
      throw new Error('not available');
    },
    connector: async (id: string) => {
      const found = connectors.find((item) => item.id === id);
      if (found === undefined) throw new Error('not available');
      return { connector: found };
    },
    connectorCaseActionScope: async (id: string) => {
      const found = connectors.find((item) => item.id === id);
      if (found === undefined) throw new Error('not available');
      return { connector: found };
    },
    ...extra,
  } as unknown as IPersonalApi;
}

describe('the Connectors tab', () => {
  it('shows identifiers for services with the same name and address', async () => {
    const other = { ...NOTES, id: 'connector-notes-2' };
    render(<ConnectorsView api={fakeApi([NOTES, other])} />);
    expect(await screen.findByText('Service ID: connector-notes-1')).toBeTruthy();
    expect(screen.getByText('Service ID: connector-notes-2')).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Notes (connector-notes-1)' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Notes (connector-notes-2)' })).toBeTruthy();
  });

  it('settles older requests before showing settings in a newly opened page', async () => {
    let finish!: (result: IConnectorsListing & { fenced: readonly string[] }) => void;
    const fence = new Promise<IConnectorsListing & { fenced: readonly string[] }>((resolve) => {
      finish = resolve;
    });
    const connectors = vi.fn(async () => ({
      callbackPath: '/connector-callback',
      connectors: [NOTES],
    }));
    render(
      <ConnectorsView api={fakeApi([], { connectors, fenceCaseActionRequests: () => fence })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(connectors).not.toHaveBeenCalled();
    await act(async () => {
      finish({ fenced: [NOTES.id], callbackPath: '/connector-callback', connectors: [NOTES] });
      await fence;
    });
    expect(await screen.findByText('Connected')).toBeTruthy();
  });

  it('keeps case controls hidden when an older server lacks the fence capability', async () => {
    const connector = { ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' };
    render(
      <ConnectorsView
        api={fakeApi([connector], {
          fenceCaseActionRequests: async () => {
            throw new ApiError(404, 'not found');
          },
        })}
      />,
    );
    await screen.findByText('Connected');
    expect(
      screen.queryByRole('region', { name: 'Case requests for Notes (connector-notes-1)' }),
    ).toBeNull();
  });

  it('keeps offline migration instructions visible when the connector list reloads', async () => {
    const reason =
      'Connector settings need offline migration. Stop every agent using this state folder and follow the case-request recovery instructions in the Personal Agent guide.';
    const connectors = vi.fn(async () => ({
      callbackPath: '/connector-callback',
      connectors: [{ ...NOTES, caseActionTools: [], caseActionScopeError: true }],
    }));
    render(
      <ConnectorsView
        api={fakeApi([], {
          connectors,
          fenceCaseActionRequests: async () => {
            throw new ApiError(400, reason);
          },
        })}
      />,
    );
    await waitFor(() => expect(connectors).toHaveBeenCalled());
    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('offers to finish an interrupted disconnect without service discovery', async () => {
    const connector: IConnectorView = {
      ...NOTES,
      status: { state: 'checking' },
      tools: undefined,
      caseActionTools: [],
      caseActionScopeError: true,
      caseActionTransition: true,
    };
    const never = new Promise<never>(() => undefined);
    const disconnect = vi.fn(async () => ({
      outcome: { removed: true, revocation: 'revoked' as const },
    }));
    render(
      <ConnectorsView
        api={fakeApi([connector], {
          connectors: () => never,
          connector: () => never,
          disconnectConnector: disconnect,
        })}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Finish disconnecting Notes (connector-notes-1)' }),
    );
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith(NOTES.id, false));
  });

  it('allows a healthy connector to be revoked while another connector cannot be fenced', async () => {
    const healthy = {
      ...NOTES,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
    };
    const broken: IConnectorView = {
      ...healthy,
      id: 'other',
      title: 'Other',
      caseActionTools: [],
      caseActionScopeError: true,
      caseActionRevision: 'broken:revision',
    };
    const fenceCaseActionRequests = async () => ({
      fenced: [NOTES.id],
      callbackPath: '/connector-callback',
      connectors: [healthy, broken],
    });
    const set = vi.fn(async () => ({
      connector: { ...healthy, caseActionTools: [], caseActionRevision: 'revision-2' },
    }));
    render(
      <ConnectorsView
        api={fakeApi([healthy, broken], { fenceCaseActionRequests, setConnectorCaseAction: set })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    expect(choice.disabled).toBe(false);
    fireEvent.click(choice);
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        NOTES.id,
        'create_note',
        false,
        'revision-1',
        expect.any(AbortSignal),
      ),
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Reset case request settings for Other (other)',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('lets a different page revoke a displayed choice while an allow is being confirmed', async () => {
    const connector: IConnectorView = {
      ...NOTES,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
      caseActionChangePending: true,
    };
    const never = new Promise<never>(() => undefined);
    const revoke = vi.fn(async () => ({
      connector: {
        ...connector,
        caseActionTools: [],
        caseActionRevision: 'revision-2',
        caseActionChangePending: false,
      },
    }));
    render(
      <ConnectorsView
        api={fakeApi([connector], {
          fenceCaseActionRequests: async () => ({
            fenced: [],
            callbackPath: '/connector-callback',
            connectors: [connector],
          }),
          connectors: () => never,
          connector: () => never,
          openConnectorCaseActions: () => never,
          setConnectorCaseAction: revoke,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    expect(choice.checked).toBe(true);
    expect(choice.disabled).toBe(false);
    fireEvent.click(choice);
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(
        NOTES.id,
        'create_note',
        false,
        'revision-1',
        expect.any(AbortSignal),
      ),
    );
  });

  it('lets the owner cancel an interrupted pending choice', async () => {
    const connector: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
      caseActionChangePending: true,
    };
    const never = new Promise<never>(() => undefined);
    const fence = vi.fn(async () => ({
      connector: { ...connector, caseActionChangePending: false, caseActionRevision: 'revision-2' },
    }));
    render(
      <ConnectorsView
        api={fakeApi([connector], {
          fenceCaseActionRequests: async () => ({
            fenced: [],
            callbackPath: '/connector-callback',
            connectors: [connector],
          }),
          connectors: () => never,
          connector: () => never,
          openConnectorCaseActions: () => never,
          fenceConnectorCaseActions: fence,
        })}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Cancel pending choice for Notes (connector-notes-1)',
      }),
    );
    await waitFor(() =>
      expect(fence).toHaveBeenCalledWith(NOTES.id, 'revision-1', expect.any(AbortSignal)),
    );
  });

  it('lets this page revoke an existing choice while another allow is pending', async () => {
    const connector: IConnectorView = {
      ...NOTES,
      tools: [...NOTES.tools!, { name: 'send_note', access: 'write' }],
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
    };
    let rejectAllow!: (error: Error) => void;
    const pending = new Promise<{ connector: IConnectorView }>((_, reject) => {
      rejectAllow = reject;
    });
    const revoked = { ...connector, caseActionTools: [], caseActionRevision: 'revision-2' };
    const set = vi.fn(async (_id: string, _tool: string, allowed: boolean) =>
      allowed ? pending : { connector: revoked },
    );
    render(
      <ConnectorsView
        api={fakeApi([connector], {
          setConnectorCaseAction: set,
          fenceConnectorCaseActions: async () => ({ connector: revoked }),
        })}
      />,
    );
    fireEvent.click(
      await screen.findByLabelText(
        'Allow send_note for case requests on Notes (connector-notes-1)',
      ),
    );
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    const existing = screen.getByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    ) as HTMLInputElement;
    expect(existing.disabled).toBe(false);
    fireEvent.click(existing);
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        NOTES.id,
        'create_note',
        false,
        'revision-1',
        expect.any(AbortSignal),
      ),
    );
    await act(async () => {
      rejectAllow(new Error('Case action settings changed'));
      await pending.catch(() => undefined);
    });
  });

  it('lets this page cancel its own pending allow after a scope refresh', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    let current: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    const never = new Promise<never>(() => undefined);
    const scope = vi.fn(async () => ({ connector: current }));
    const set = vi.fn(() => never);
    const fence = vi.fn(async () => {
      current = { ...current, caseActionChangePending: false, caseActionRevision: 'revision-2' };
      return { connector: current };
    });
    render(
      <ConnectorsView
        api={fakeApi([current], {
          connectors: () => never,
          connectorCaseActionScope: scope,
          setConnectorCaseAction: set,
          fenceConnectorCaseActions: fence,
        })}
      />,
    );
    fireEvent.click(
      await screen.findByLabelText(
        'Allow create_note for case requests on Notes (connector-notes-1)',
      ),
    );
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(scope).toHaveBeenCalled());
    current = { ...current, caseActionChangePending: true };
    await act(async () => {
      tick();
      await Promise.resolve();
      await Promise.resolve();
    });
    const cancel = (await screen.findByRole('button', {
      name: 'Cancel pending choice for Notes (connector-notes-1)',
    })) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(fence).toHaveBeenCalledWith(NOTES.id, 'revision-1', expect.any(AbortSignal)),
    );
  });

  it('shows and revokes a saved grant without waiting for any connector discovery', async () => {
    const pending: IConnectorView = {
      ...NOTES,
      status: { state: 'checking' },
      tools: undefined,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
    };
    const never = new Promise<never>(() => undefined);
    const fenceCaseActionRequests = async () => ({
      fenced: [NOTES.id],
      callbackPath: '/connector-callback',
      connectors: [pending],
    });
    const set = vi.fn(async () => ({
      connector: { ...pending, caseActionTools: [], caseActionRevision: 'revision-2' },
    }));
    render(
      <ConnectorsView
        api={fakeApi([], {
          fenceCaseActionRequests,
          connectors: () => never,
          connector: () => never,
          setConnectorCaseAction: set,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    expect(choice.checked).toBe(true);
    fireEvent.click(choice);
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        NOTES.id,
        'create_note',
        false,
        'revision-1',
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Allow create_note for case requests on Notes (connector-notes-1)'),
      ).toBeNull(),
    );
  });

  it('refreshes each scope even while the connector list never returns', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    let current: IConnectorView = {
      ...NOTES,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
    };
    const never = new Promise<never>(() => undefined);
    const scope = vi.fn(async () => ({ connector: current }));
    render(
      <ConnectorsView
        api={fakeApi([current], { connectors: () => never, connectorCaseActionScope: scope })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    await act(async () => {
      await Promise.resolve();
    });
    expect(choice.checked).toBe(true);
    current = { ...current, caseActionTools: [], caseActionRevision: 'revision-2' };
    await act(async () => {
      tick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(choice.checked).toBe(false);
  });

  it('updates the connector inventory while service discovery is stalled', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const first = { ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' };
    const other = { ...first, id: 'other', title: 'Other', status: { state: 'checking' as const } };
    let items: readonly IConnectorView[] = [first];
    const never = new Promise<never>(() => undefined);
    render(
      <ConnectorsView
        api={fakeApi([first], {
          connectors: () => never,
          connectorInventory: async () => ({
            callbackPath: '/connector-callback',
            connectors: items,
          }),
          connector: () => never,
          openConnectorCaseActions: async (id) => ({
            connector: items.find((item) => item.id === id)!,
          }),
        })}
      />,
    );
    await screen.findByText('Notes');
    items = [first, other];
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await screen.findByText('Other');
    items = [other];
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText('Notes')).toBeNull());
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('keeps a newer full inventory when an older summary arrives late', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const first = { ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' };
    const other = { ...first, id: 'other', title: 'Other' };
    let finishList!: (value: IConnectorsListing) => void;
    let finishSummary!: (value: IConnectorsListing) => void;
    const list = new Promise<IConnectorsListing>((resolve) => {
      finishList = resolve;
    });
    const summary = new Promise<IConnectorsListing>((resolve) => {
      finishSummary = resolve;
    });
    render(
      <ConnectorsView
        api={fakeApi([first], { connectors: () => list, connectorInventory: () => summary })}
      />,
    );
    await screen.findByText('Notes');
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await act(async () => {
      finishList({ callbackPath: '/connector-callback', connectors: [first, other] });
      await list;
    });
    await screen.findByText('Other');
    await act(async () => {
      finishSummary({ callbackPath: '/connector-callback', connectors: [first] });
      await summary;
    });
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('does not restore an old writable tool view after the owner blocks it', async () => {
    const first = { ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' };
    const blocked = {
      ...first,
      tools: first.tools!.map((tool) =>
        tool.name === 'create_note'
          ? { ...tool, access: 'blocked' as const, decision: 'blocked' as const }
          : tool,
      ),
    };
    let finish!: (result: { connector: IConnectorView }) => void;
    const discovery = new Promise<{ connector: IConnectorView }>((resolve) => {
      finish = resolve;
    });
    const never = new Promise<never>(() => undefined);
    render(
      <ConnectorsView
        api={fakeApi([first], {
          connectors: () => never,
          connector: vi
            .fn()
            .mockImplementationOnce(() => discovery)
            .mockImplementation(() => never),
          decideConnectorTool: async () => ({ connector: blocked }),
        })}
      />,
    );
    const select = (await screen.findByLabelText('What create_note may do')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'blocked' } });
    await waitFor(() =>
      expect((screen.getByLabelText('What create_note may do') as HTMLSelectElement).value).toBe(
        'blocked',
      ),
    );
    await act(async () => {
      finish({ connector: first });
      await discovery;
    });
    expect((screen.getByLabelText('What create_note may do') as HTMLSelectElement).value).toBe(
      'blocked',
    );
  });

  it('rechecks a pending decision after an individual view observes a newer change', async () => {
    const first = { ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' };
    const changed = (names: readonly string[]): IConnectorView => ({
      ...first,
      tools: first.tools!.map((tool) =>
        names.includes(tool.name) ? { ...tool, access: 'blocked', decision: 'blocked' } : tool,
      ),
    });
    let finishOld!: (result: { connector: IConnectorView }) => void;
    let finishObserved!: (result: { connector: IConnectorView }) => void;
    let finishFresh!: (result: { connector: IConnectorView }) => void;
    const old = new Promise<{ connector: IConnectorView }>((resolve) => {
      finishOld = resolve;
    });
    const observed = new Promise<{ connector: IConnectorView }>((resolve) => {
      finishObserved = resolve;
    });
    const fresh = new Promise<{ connector: IConnectorView }>((resolve) => {
      finishFresh = resolve;
    });
    const never = new Promise<never>(() => undefined);
    const connector = vi
      .fn()
      .mockImplementationOnce(() => observed)
      .mockImplementationOnce(() => fresh)
      .mockImplementation(() => never);
    render(
      <ConnectorsView
        api={fakeApi([first], {
          connectors: () => never,
          connector,
          decideConnectorTool: () => old,
        })}
      />,
    );
    await screen.findByLabelText('What search_notes may do');
    await waitFor(() => expect(connector).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('What search_notes may do'), {
      target: { value: 'blocked' },
    });
    await act(async () => {
      finishObserved({ connector: changed(['create_note']) });
      await observed;
    });
    await act(async () => {
      finishOld({ connector: changed(['search_notes']) });
      await old;
    });
    expect((screen.getByLabelText('What search_notes may do') as HTMLSelectElement).value).toBe(
      'default',
    );
    await waitFor(() => expect(connector.mock.calls.length).toBeGreaterThan(1));
    await act(async () => {
      finishFresh({ connector: changed(['search_notes', 'create_note']) });
      await fresh;
    });
    await waitFor(() =>
      expect((screen.getByLabelText('What create_note may do') as HTMLSelectElement).value).toBe(
        'blocked',
      ),
    );
  });

  it('keeps newer decisions when two changes finish out of order', async () => {
    const first = { ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' };
    const changed = (names: readonly string[]): IConnectorView => ({
      ...first,
      tools: first.tools!.map((tool) =>
        names.includes(tool.name) ? { ...tool, access: 'blocked', decision: 'blocked' } : tool,
      ),
    });
    let finish!: (result: { connector: IConnectorView }) => void;
    const older = new Promise<{ connector: IConnectorView }>((resolve) => {
      finish = resolve;
    });
    const never = new Promise<never>(() => undefined);
    render(
      <ConnectorsView
        api={fakeApi([first], {
          connectors: () => never,
          connector: () => never,
          decideConnectorTool: async (_id, tool) =>
            tool === 'search_notes'
              ? older
              : { connector: changed(['search_notes', 'create_note']) },
        })}
      />,
    );
    fireEvent.change(await screen.findByLabelText('What search_notes may do'), {
      target: { value: 'blocked' },
    });
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'blocked' },
    });
    await waitFor(() =>
      expect((screen.getByLabelText('What create_note may do') as HTMLSelectElement).value).toBe(
        'blocked',
      ),
    );
    await act(async () => {
      finish({ connector: changed(['search_notes']) });
      await older;
    });
    expect((screen.getByLabelText('What create_note may do') as HTMLSelectElement).value).toBe(
      'blocked',
    );
    expect((screen.getByLabelText('What search_notes may do') as HTMLSelectElement).value).toBe(
      'blocked',
    );
  });

  it('settles a slow connector open after repeated identical polls', async () => {
    const initial: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    let finish!: (result: { connector: IConnectorView }) => void;
    const opening = new Promise<{ connector: IConnectorView }>((resolve) => {
      finish = resolve;
    });
    const open = vi.fn(() => opening);
    const connectors = vi.fn(async () => ({
      callbackPath: '/connector-callback',
      connectors: [initial],
    }));
    const fresh = { ...initial, caseActionRevision: 'revision-2' };
    const scope = vi.fn(async () => ({ connector: fresh }));
    const decide = vi.fn(async () => ({ connector: initial }));
    const api = fakeApi([initial], {
      fenceCaseActionRequests: async () => ({
        fenced: [],
        callbackPath: '/connector-callback',
        connectors: [initial],
      }),
      openConnectorCaseActions: open,
      connectorCaseActionScope: scope,
      connectors,
      decideConnectorTool: decide,
    });
    render(<ConnectorsView api={api} />);
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(choice.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'write' },
    });
    await waitFor(() => expect(connectors.mock.calls.length).toBeGreaterThan(1));
    await act(async () => {
      finish({ connector: fresh });
      await opening;
    });
    await waitFor(() => expect(choice.disabled).toBe(false));
  });

  it('does not apply an old connector-open response after the owner resets that scope', async () => {
    const broken: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionScopeError: true,
      caseActionRevision: 'broken:revision',
    };
    const repaired: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-2',
    };
    let finish!: (result: { connector: IConnectorView }) => void;
    const opening = new Promise<{ connector: IConnectorView }>((resolve) => {
      finish = resolve;
    });
    const open = vi.fn(() => opening);
    let current = broken;
    const reset = vi.fn(async () => {
      current = repaired;
      return { connector: repaired };
    });
    const api = fakeApi([broken], {
      fenceCaseActionRequests: async () => ({
        fenced: [],
        callbackPath: '/connector-callback',
        connectors: [broken],
      }),
      openConnectorCaseActions: open,
      resetConnectorCaseActions: reset,
      connectors: async () => ({ callbackPath: '/connector-callback', connectors: [current] }),
      connectorCaseActionScope: async () => ({ connector: current }),
    });
    render(<ConnectorsView api={api} />);
    await waitFor(() => expect(open).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Reset case request settings for Notes (connector-notes-1)',
      }),
    );
    await waitFor(() => expect(reset).toHaveBeenCalled());
    await act(async () => {
      finish({ connector: broken });
      await opening;
    });
    expect(
      screen.queryByRole('button', {
        name: 'Reset case request settings for Notes (connector-notes-1)',
      }),
    ).toBeNull();
  });

  it('says what to do when nothing is connected', async () => {
    render(<ConnectorsView api={fakeApi([])} />);
    await waitFor(() => expect(screen.getByText(/Nothing connected yet/u)).toBeTruthy());
  });

  it('splits a connected service’s tools into what the agent may do on its own and what waits for the person', async () => {
    render(<ConnectorsView api={fakeApi([NOTES])} />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    expect(screen.getByText('notes.read notes.write')).toBeTruthy();
    const reads = screen.getByRole('region', { name: 'Reads' });
    const writes = screen.getByRole('region', { name: 'Writes' });
    const blocked = screen.getByRole('region', { name: 'Blocked' });
    expect(within(reads).getByText('search_notes')).toBeTruthy();
    expect(within(writes).getByText('create_note')).toBeTruthy();
    expect(within(blocked).getByText('delete_note')).toBeTruthy();
    expect(within(writes).getByText(/waits for your approval, every time/u)).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Case requests for Notes (connector-notes-1)' }),
    ).toBeNull();
  });

  it('lets the person select only writable tools for case requests and remove them again', async () => {
    let current: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    const set = vi.fn(async (_id: string, tool: string, allowed: boolean) => {
      current = { ...current, caseActionTools: allowed ? [tool] : [] };
      return { connector: current };
    });
    const api = fakeApi([], {
      connectors: async () => ({ callbackPath: '/connector-callback', connectors: [current] }),
      setConnectorCaseAction: set,
    });
    render(<ConnectorsView api={api} />);
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    expect(choice.checked).toBe(false);
    expect(screen.queryByLabelText(/Allow search_notes for case requests/u)).toBeNull();
    expect(screen.queryByLabelText(/Allow delete_note for case requests/u)).toBeNull();
    expect(screen.getByText(/approve each action separately/u)).toBeTruthy();
    fireEvent.click(choice);
    await waitFor(() => expect(choice.checked).toBe(true));
    expect(set).toHaveBeenCalledWith(
      NOTES.id,
      'create_note',
      true,
      'revision-1',
      expect.any(AbortSignal),
    );
    fireEvent.click(choice);
    await waitFor(() => expect(choice.checked).toBe(false));
    expect(set).toHaveBeenLastCalledWith(
      NOTES.id,
      'create_note',
      false,
      'revision-1',
      expect.any(AbortSignal),
    );
  });

  it('still lets the person revoke a previously allowed tool while the service is disconnected', async () => {
    const idle: IConnectorView = {
      ...NOTES,
      status: { state: 'not-connected' },
      tools: undefined,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
    };
    const set = vi.fn(async () => ({ connector: idle }));
    render(<ConnectorsView api={fakeApi([idle], { setConnectorCaseAction: set })} />);
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    expect(choice.checked).toBe(true);
    expect(choice.disabled).toBe(false);
    fireEvent.click(choice);
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        NOTES.id,
        'create_note',
        false,
        'revision-1',
        expect.any(AbortSignal),
      ),
    );
  });

  it('makes invisible characters and literal backslashes visible in tool names', async () => {
    const unusual: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
      tools: [
        { name: 'send\u200b_note', access: 'write' },
        { name: 'send\\u{200b}_note', access: 'write' },
        { name: 'send\u034f_note', access: 'write' },
        { name: 'send\ufe0f_note', access: 'write' },
        { name: 'send note', access: 'write' },
        { name: 'send  note', access: 'write' },
        { name: 'caf\u00e9', access: 'write' },
        { name: 'cafe\u0301', access: 'write' },
      ],
    };
    const set = vi.fn(async () => ({ connector: unusual }));
    render(<ConnectorsView api={fakeApi([unusual], { setConnectorCaseAction: set })} />);
    const first = await screen.findByLabelText(
      'Allow send\\u{200b}_note for case requests on Notes (connector-notes-1)',
    );
    expect(
      screen.getByLabelText(
        'Allow send\\\\u{200b}_note for case requests on Notes (connector-notes-1)',
      ),
    ).toBeTruthy();
    for (const label of [
      'send\\u{34f}_note',
      'send\\u{fe0f}_note',
      'send\\u{20}note',
      'send\\u{20}\\u{20}note',
      'caf\\u{e9}',
      'cafe\\u{301}',
    ])
      expect(
        screen.getByLabelText(`Allow ${label} for case requests on Notes (connector-notes-1)`),
      ).toBeTruthy();
    fireEvent.click(first);
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith(
        NOTES.id,
        'send\u200b_note',
        true,
        'revision-1',
        expect.any(AbortSignal),
      ),
    );
  });

  it('shows a refused change and leaves the saved setting visible', async () => {
    const set = vi.fn(async () => {
      throw new Error('Settings changed; try again');
    });
    render(
      <ConnectorsView
        api={fakeApi([{ ...NOTES, caseActionTools: [], caseActionRevision: 'revision-1' }], {
          setConnectorCaseAction: set,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    fireEvent.click(choice);
    await screen.findByText('Settings changed; try again');
    expect(choice.checked).toBe(false);
    expect(choice.disabled).toBe(true);
  });

  it('keeps a saved permission when an older list returns, and can revoke while the list is stalled', async () => {
    const initial: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    let finishOld!: (listing: IConnectorsListing) => void;
    const old = new Promise<IConnectorsListing>((resolve) => {
      finishOld = resolve;
    });
    const listing = { callbackPath: '/connector-callback', connectors: [initial] };
    const connectors = vi
      .fn()
      .mockResolvedValueOnce(listing)
      .mockImplementation(() => old);
    const decide = vi.fn(async () => ({ connector: initial }));
    const set = vi.fn(async (_id: string, tool: string, allowed: boolean) => ({
      connector: { ...initial, caseActionTools: allowed ? [tool] : [] },
    }));
    render(
      <ConnectorsView
        api={fakeApi([], { connectors, decideConnectorTool: decide, setConnectorCaseAction: set })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'write' },
    });
    await waitFor(() => expect(connectors).toHaveBeenCalledTimes(2));
    fireEvent.click(choice);
    await waitFor(() => expect(choice.checked).toBe(true));
    expect(choice.disabled).toBe(false);
    await act(async () => {
      finishOld(listing);
      await old;
    });
    expect(choice.checked).toBe(true);
    fireEvent.click(choice);
    await waitFor(() => expect(choice.checked).toBe(false));
    expect(set).toHaveBeenLastCalledWith(
      NOTES.id,
      'create_note',
      false,
      'revision-1',
      expect.any(AbortSignal),
    );
  });

  it('rechecks a delayed mutation response after a poll observes a newer revision', async () => {
    let current: IConnectorView = {
      ...NOTES,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-1',
    };
    const initial = current;
    let finish!: (result: { connector: IConnectorView }) => void;
    const pending = new Promise<{ connector: IConnectorView }>((resolve) => {
      finish = resolve;
    });
    const set = vi.fn(() => pending);
    const connectors = vi.fn(async () => ({
      callbackPath: '/connector-callback',
      connectors: [current],
    }));
    const scope = vi.fn(async () => ({ connector: current }));
    const decide = vi.fn(async () => ({ connector: current }));
    render(
      <ConnectorsView
        api={fakeApi([initial], {
          connectors,
          connectorCaseActionScope: scope,
          setConnectorCaseAction: set,
          decideConnectorTool: decide,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    fireEvent.click(choice);
    await waitFor(() => expect(set).toHaveBeenCalled());
    current = { ...initial, caseActionRevision: 'revision-3' };
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'write' },
    });
    await waitFor(() => expect(connectors.mock.calls.length).toBeGreaterThan(1));
    await act(async () => {
      finish({ connector: { ...initial, caseActionTools: [], caseActionRevision: 'revision-2' } });
      await pending;
    });
    await waitFor(() => expect(scope).toHaveBeenCalled());
    await waitFor(() => expect(choice.disabled).toBe(false));
    expect(choice.checked).toBe(true);
  });

  it('eventually shows a newer scope observed by a poll that could not update the card', async () => {
    const initial: IConnectorView = {
      ...NOTES,
      caseActionTools: ['create_note'],
      caseActionRevision: 'revision-0',
    };
    let current = initial;
    let finishOld!: (listing: IConnectorsListing) => void;
    const old = new Promise<IConnectorsListing>((resolve) => {
      finishOld = resolve;
    });
    const listing = { callbackPath: '/connector-callback', connectors: [initial] };
    const connectors = vi
      .fn()
      .mockResolvedValueOnce(listing)
      .mockImplementation(() => old);
    const scope = vi.fn(async () => ({ connector: current }));
    const decide = vi.fn(async () => ({ connector: current }));
    const set = vi.fn(async () => {
      current = { ...initial, caseActionTools: [], caseActionRevision: 'revision-1' };
      return { connector: current };
    });
    render(
      <ConnectorsView
        api={fakeApi([initial], {
          connectors,
          connectorCaseActionScope: scope,
          decideConnectorTool: decide,
          setConnectorCaseAction: set,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    await waitFor(() => expect(connectors).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'write' },
    });
    await waitFor(() => expect(connectors).toHaveBeenCalledTimes(2));
    fireEvent.click(choice);
    await waitFor(() => expect(choice.checked).toBe(false));
    current = { ...initial, caseActionRevision: 'revision-2' };
    await act(async () => {
      finishOld({ ...listing, connectors: [current] });
      await old;
    });
    await waitFor(() => expect(choice.checked).toBe(true), { timeout: 5_000 });
  });

  it('keeps an uncertain permission disabled until its pending change is fenced', async () => {
    const initial: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    const set = vi.fn().mockRejectedValueOnce(new Error('The reply was lost'));
    const fenceRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('Still offline'))
      .mockResolvedValueOnce({ connector: { ...initial, caseActionRevision: 'revision-2' } });
    render(
      <ConnectorsView
        api={fakeApi([initial], {
          setConnectorCaseAction: set,
          fenceConnectorCaseActions: fenceRequest,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    fireEvent.click(choice);
    const secure = await screen.findByRole('button', {
      name: 'Settle case request settings for Notes (connector-notes-1)',
    });
    await waitFor(() => expect(fenceRequest).toHaveBeenCalledTimes(1));
    expect(choice.disabled).toBe(true);
    fireEvent.click(secure);
    await waitFor(() => expect(choice.disabled).toBe(false));
    expect(set).toHaveBeenNthCalledWith(
      1,
      NOTES.id,
      'create_note',
      true,
      'revision-1',
      expect.any(AbortSignal),
    );
    expect(fenceRequest).toHaveBeenCalledTimes(2);
    expect(fenceRequest).toHaveBeenCalledWith(NOTES.id, 'revision-1', expect.any(AbortSignal));
    expect(choice.checked).toBe(false);
    expect(choice.disabled).toBe(false);
  });

  it('fences a stalled allow after the discovery deadline', async () => {
    vi.useFakeTimers();
    try {
      const initial: IConnectorView = {
        ...NOTES,
        caseActionTools: [],
        caseActionRevision: 'revision-1',
      };
      const set = vi.fn(
        (_id: string, _tool: string, _allowed: boolean, _revision: string, _signal?: AbortSignal) =>
          new Promise<never>(() => undefined),
      );
      const fence = vi.fn(async () => ({
        connector: { ...initial, caseActionRevision: 'revision-2' },
      }));
      render(
        <ConnectorsView
          api={fakeApi([initial], {
            setConnectorCaseAction: set,
            fenceConnectorCaseActions: fence,
          })}
        />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const choice = screen.getByLabelText(
        'Allow create_note for case requests on Notes (connector-notes-1)',
      ) as HTMLInputElement;
      fireEvent.click(choice);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(75_000);
      });
      expect(set).toHaveBeenCalledTimes(1);
      expect((set.mock.calls[0]![4] as AbortSignal).aborted).toBe(true);
      expect(fence).toHaveBeenCalledWith(NOTES.id, 'revision-1', expect.any(AbortSignal));
      expect(choice.disabled).toBe(false);
      expect(choice.checked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a secured permission when an older poll returns after the fence', async () => {
    const initial: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    let finishOld!: (listing: IConnectorsListing) => void;
    const old = new Promise<IConnectorsListing>((resolve) => {
      finishOld = resolve;
    });
    let finishFence!: (result: { connector: IConnectorView }) => void;
    const fence = new Promise<{ connector: IConnectorView }>((resolve) => {
      finishFence = resolve;
    });
    const listing = { callbackPath: '/connector-callback', connectors: [initial] };
    const connectors = vi
      .fn()
      .mockResolvedValueOnce(listing)
      .mockImplementation(() => old);
    const set = vi.fn().mockRejectedValueOnce(new Error('The reply was lost'));
    const fenceRequest = vi.fn().mockImplementationOnce(() => fence);
    const decide = vi.fn(async () => ({ connector: initial }));
    render(
      <ConnectorsView
        api={fakeApi([], {
          connectors,
          setConnectorCaseAction: set,
          fenceConnectorCaseActions: fenceRequest,
          decideConnectorTool: decide,
        })}
      />,
    );
    const choice = (await screen.findByLabelText(
      'Allow create_note for case requests on Notes (connector-notes-1)',
    )) as HTMLInputElement;
    fireEvent.click(choice);
    await waitFor(() => expect(fenceRequest).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'write' },
    });
    await waitFor(() => expect(connectors).toHaveBeenCalledTimes(2));
    await act(async () => {
      finishFence({ connector: { ...initial, caseActionRevision: 'revision-2' } });
      await fence;
    });
    await waitFor(() => expect(choice.disabled).toBe(false));
    await act(async () => {
      finishOld({ ...listing, connectors: [{ ...initial, caseActionTools: ['create_note'] }] });
      await old;
    });
    expect(choice.checked).toBe(false);
  });

  it('lets the person reset a scope that becomes unreadable while a change is uncertain', async () => {
    let current: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    const set = vi.fn().mockRejectedValue(new Error('The reply was lost'));
    const fence = vi.fn().mockRejectedValue(new Error('The scope is unreadable'));
    const reset = vi.fn(async () => {
      current = { ...current, caseActionScopeError: false, caseActionRevision: 'revision-2' };
      return { connector: current };
    });
    const decide = vi.fn(async () => ({ connector: current }));
    const api = fakeApi([], {
      connectors: async () => ({ callbackPath: '/connector-callback', connectors: [current] }),
      setConnectorCaseAction: set,
      fenceConnectorCaseActions: fence,
      resetConnectorCaseActions: reset,
      decideConnectorTool: decide,
    });
    render(<ConnectorsView api={api} />);
    fireEvent.click(
      await screen.findByLabelText(
        'Allow create_note for case requests on Notes (connector-notes-1)',
      ),
    );
    await waitFor(() => expect(fence).toHaveBeenCalled());
    current = { ...current, caseActionScopeError: true, caseActionRevision: 'broken:revision' };
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'write' },
    });
    const resetButton = await screen.findByRole('button', {
      name: 'Reset case request settings for Notes (connector-notes-1)',
    });
    expect((resetButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resetButton);
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith(NOTES.id, 'broken:revision', expect.any(AbortSignal)),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: 'Settle case request settings for Notes (connector-notes-1)',
        }),
      ).toBeNull(),
    );
  });

  it('shows a slow list before starting its next poll', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    let finish!: (listing: IConnectorsListing) => void;
    const first = new Promise<IConnectorsListing>((resolve) => {
      finish = resolve;
    });
    const connectors = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(() => new Promise(() => undefined));
    render(<ConnectorsView api={fakeApi([], { connectors })} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(connectors).toHaveBeenCalledTimes(1);
    act(() => tick());
    expect(connectors).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ callbackPath: '/connector-callback', connectors: [NOTES] });
      await first;
    });
    expect(await screen.findByText('Connected')).toBeTruthy();
    act(() => tick());
    expect(connectors).toHaveBeenCalledTimes(2);
  });

  it('offers an explicit reset when settings cannot be read, including while disconnected', async () => {
    let current: IConnectorView = {
      ...NOTES,
      status: { state: 'not-connected' },
      tools: undefined,
      caseActionTools: [],
      caseActionRevision: 'broken:revision',
      caseActionScopeError: true,
    };
    const reset = vi.fn(async () => {
      current = { ...current, caseActionScopeError: false, caseActionRevision: 'revision-2' };
      return { connector: current };
    });
    const api = fakeApi([], {
      connectors: async () => ({ callbackPath: '/connector-callback', connectors: [current] }),
      resetConnectorCaseActions: reset,
    });
    render(<ConnectorsView api={api} />);
    expect(await screen.findByText(/Resetting removes all allowed tools/u)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reset case request settings for Notes (connector-notes-1)',
      }),
    );
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith(NOTES.id, 'broken:revision', expect.any(AbortSignal)),
    );
    await screen.findByText('Connect this service to select writable tools.');
  });

  it('names which connector each reset will affect', async () => {
    const damaged: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
      caseActionScopeError: true,
    };
    const other: IConnectorView = { ...damaged, id: 'other' };
    render(<ConnectorsView api={fakeApi([damaged, other])} />);
    expect(
      await screen.findByRole('button', {
        name: 'Reset case request settings for Notes (connector-notes-1)',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reset case request settings for Notes (other)' }),
    ).toBeTruthy();
  });

  it('distinguishes tool choices on connectors that share a title', async () => {
    const first: IConnectorView = {
      ...NOTES,
      caseActionTools: [],
      caseActionRevision: 'revision-1',
    };
    const second: IConnectorView = { ...first, id: 'other' };
    render(<ConnectorsView api={fakeApi([first, second])} />);
    expect(
      await screen.findByLabelText(
        'Allow create_note for case requests on Notes (connector-notes-1)',
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Allow create_note for case requests on Notes (other)'),
    ).toBeTruthy();
  });

  it('records the person’s decision about a tool, and returns it to the service’s claim with null', async () => {
    const decide = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([NOTES], { decideConnectorTool: decide })} />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('What create_note may do'), {
      target: { value: 'blocked' },
    });
    await waitFor(() => expect(decide).toHaveBeenCalledWith(NOTES.id, 'create_note', 'blocked'));
    fireEvent.change(screen.getByLabelText('What delete_note may do'), {
      target: { value: 'default' },
    });
    await waitFor(() => expect(decide).toHaveBeenCalledWith(NOTES.id, 'delete_note', null));
  });

  it('starts a sign-in from this page’s own origin and opens the address in this browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const connect = vi.fn(async () => ({
      status: {
        state: 'connecting' as const,
        authorizationUrl: 'https://auth.example/authorize?x=1',
      },
    }));
    const idle: IConnectorView = { ...NOTES, status: { state: 'not-connected' }, tools: undefined };
    render(<ConnectorsView api={fakeApi([idle], { connectConnector: connect })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith(NOTES.id, { origin: window.location.origin }),
    );
    expect(open).toHaveBeenCalledWith(
      'https://auth.example/authorize?x=1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('takes a client secret only for a client the person registered, sends it with that one sign-in and does not keep it', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const connect = vi.fn(async () => ({
      status: { state: 'connecting' as const, authorizationUrl: 'https://auth.example/a' },
    }));
    const registered: IConnectorView = {
      ...NOTES,
      status: { state: 'not-connected' },
      tools: undefined,
      oauth: { clientId: 'my-client' },
    };
    const { unmount } = render(
      <ConnectorsView api={fakeApi([registered], { connectConnector: connect })} />,
    );
    const field = (await screen.findByLabelText(/Client secret for Notes/u)) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: 'the-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(connect).toHaveBeenCalledWith(NOTES.id, {
        origin: window.location.origin,
        clientSecret: 'the-secret',
      }),
    );
    // The field is emptied as the request goes, and the secret appears nowhere on the page.
    expect(field.value).toBe('');
    expect(document.body.textContent).not.toContain('the-secret');
    unmount();
    // A connector without a client id the person registered has nothing to type.
    render(
      <ConnectorsView
        api={fakeApi([{ ...NOTES, status: { state: 'not-connected' }, tools: undefined }])}
      />,
    );
    await screen.findByRole('button', { name: 'Connect' });
    expect(screen.queryByLabelText(/Client secret/u)).toBeNull();
  });

  it('takes the token of a token service in a password field, sends it with that one request and does not keep it', async () => {
    const connect = vi.fn(async () => ({ status: { state: 'connected' as const } }));
    const tracker: IConnectorView = {
      ...NOTES,
      auth: 'token',
      tokenHeader: 'X-Api-Key',
      status: { state: 'not-connected' },
      tools: undefined,
    };
    render(<ConnectorsView api={fakeApi([tracker], { connectConnector: connect })} />);
    const field = (await screen.findByLabelText('Token for Notes')) as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(screen.getByText(/in the X-Api-Key header/u)).toBeTruthy();
    // Nothing to send yet, and nothing of an OAuth sign-in on the card.
    const button = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByLabelText(/Client secret/u)).toBeNull();
    fireEvent.change(field, { target: { value: 'typed-token' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(connect).toHaveBeenCalledWith(NOTES.id, { token: 'typed-token' }));
    expect(field.value).toBe('');
    expect(document.body.textContent).not.toContain('typed-token');
  });

  it('asks for a new token, not a sign-in, when the service stops accepting the one it has', async () => {
    const refused: IConnectorView = {
      ...NOTES,
      auth: 'token',
      status: { state: 'needs-sign-in' },
      tools: undefined,
    };
    render(<ConnectorsView api={fakeApi([refused])} />);
    await screen.findByText('The service no longer accepts the token');
    expect(screen.getByLabelText('Token for Notes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
  });

  describe('replacing the token of a connected service', () => {
    const connected: IConnectorView = { ...NOTES, auth: 'token' };

    it('offers a password field and a button that waits for something to send, only on a connected token card', async () => {
      render(<ConnectorsView api={fakeApi([connected])} />);
      const field = (await screen.findByLabelText('New token for Notes')) as HTMLInputElement;
      expect(field.type).toBe('password');
      const button = screen.getByRole('button', { name: 'Replace token' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.change(field, { target: { value: 'next-token' } });
      expect(button.disabled).toBe(false);
      // It sits beside Disconnect, not instead of it.
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
      cleanup();

      render(<ConnectorsView api={fakeApi([NOTES])} />);
      await screen.findByText('Connected');
      expect(screen.queryByLabelText('New token for Notes')).toBeNull();
      cleanup();

      const waiting: IConnectorView = {
        ...connected,
        status: { state: 'not-connected' },
        tools: undefined,
      };
      render(<ConnectorsView api={fakeApi([waiting])} />);
      await screen.findByLabelText('Token for Notes');
      expect(screen.queryByLabelText('New token for Notes')).toBeNull();
    });

    it('says the service refused the new token and that the old one is still used, and never shows the card as failed', async () => {
      const replace = vi.fn(async () => ({
        replaced: false,
        reason: 'rejected' as const,
        status: { state: 'connected' as const },
      }));
      render(<ConnectorsView api={fakeApi([connected], { replaceConnectorToken: replace })} />);
      fireEvent.change(await screen.findByLabelText('New token for Notes'), {
        target: { value: 'wrong-token' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Replace token' }));
      await screen.findByText(
        'The service refused the new token (rejected). Your agent still uses the token it had.',
      );
      expect(replace).toHaveBeenCalledWith(NOTES.id, 'wrong-token');
      expect(screen.getByText('Connected')).toBeTruthy();
      expect(screen.queryByText(/Could not connect/u)).toBeNull();
      // The tools and the way to disconnect are still there.
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    });

    it('says the new token is used and that case choices are to be made again, and clears what was typed', async () => {
      const replace = vi.fn(async () => ({
        replaced: true,
        status: { state: 'connected' as const },
      }));
      render(<ConnectorsView api={fakeApi([connected], { replaceConnectorToken: replace })} />);
      const field = (await screen.findByLabelText('New token for Notes')) as HTMLInputElement;
      fireEvent.change(field, { target: { value: 'next-token' } });
      fireEvent.click(screen.getByRole('button', { name: 'Replace token' }));
      await screen.findByText(
        'The new token works and is now used. Choose again which tools case requests may use.',
      );
      expect(field.value).toBe('');
      expect(document.body.textContent).not.toContain('next-token');
      expect(replace).toHaveBeenCalledWith(NOTES.id, 'next-token');
    });
  });

  it('shows a service that needs no sign-in with its tools, and nothing to connect or disconnect', async () => {
    const open: IConnectorView = { ...NOTES, auth: 'none', status: { state: 'connected' } };
    render(<ConnectorsView api={fakeApi([open])} />);
    await screen.findByText('This service needs no sign-in.');
    expect(
      within(screen.getByRole('region', { name: 'Reads' })).getByText('search_notes'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect/u })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('says the token was deleted but the service still honours it, when a token connector is disconnected', async () => {
    const disconnect = vi.fn(async () => ({
      outcome: { removed: true, revocation: 'unsupported' as const },
    }));
    const tracker: IConnectorView = { ...NOTES, auth: 'token' };
    render(<ConnectorsView api={fakeApi([tracker], { disconnectConnector: disconnect })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(
        screen.getByText(
          /deleted the token\. The service keeps the token valid until you revoke it there/u,
        ),
      ).toBeTruthy(),
    );
  });

  it('offers the sign-in page as a link while it waits, and shows a failure by its fixed word', async () => {
    const waiting: IConnectorView = {
      ...NOTES,
      status: { state: 'connecting', authorizationUrl: 'https://auth.example/authorize' },
      tools: undefined,
    };
    const first = render(<ConnectorsView api={fakeApi([waiting])} />);
    const link = await screen.findByRole('link', { name: 'Open the sign-in page' });
    expect(link.getAttribute('href')).toBe('https://auth.example/authorize');
    expect(link.getAttribute('rel')).toContain('noopener');
    first.unmount();
    const failed: IConnectorView = {
      ...NOTES,
      status: { state: 'failed', reason: 'authorization-denied' },
      tools: undefined,
    };
    render(<ConnectorsView api={fakeApi([failed])} />);
    await waitFor(() =>
      expect(screen.getByText(/Could not connect \(authorization-denied\)/u)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
  });

  it('says what to do when the service offers no way to get a client, instead of only a fixed word', async () => {
    const failed: IConnectorView = {
      ...NOTES,
      status: { state: 'failed', reason: 'registration-unavailable' },
      tools: undefined,
    };
    const { unmount } = render(<ConnectorsView api={fakeApi([failed])} />);
    await screen.findByText(/does not register clients automatically/u);
    unmount();
    // A reason the person cannot act on stays a fixed word with no advice attached.
    render(
      <ConnectorsView
        api={fakeApi([{ ...failed, status: { state: 'failed', reason: 'authorization-denied' } }])}
      />,
    );
    await screen.findByText(/Could not connect \(authorization-denied\)/u);
    expect(screen.queryByText(/does not register clients automatically/u)).toBeNull();
  });

  it('tells the person what disconnecting did at the service, with nothing to ask when nothing was pulled', async () => {
    const disconnect = vi.fn(async () => ({
      outcome: { removed: true, revocation: 'failed' as const },
    }));
    render(<ConnectorsView api={fakeApi([NOTES], { disconnectConnector: disconnect })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith(NOTES.id, false));
    await waitFor(() =>
      expect(
        screen.getByText(/did not confirm the revocation; the access ends when it expires/u),
      ).toBeTruthy(),
    );
  });

  it('asks whether to keep or forget what the service put in the library, and says what was forgotten', async () => {
    const disconnect = vi.fn(async () => ({
      outcome: { removed: true, revocation: 'revoked' as const },
      forgotten: 2,
    }));
    render(
      <ConnectorsView
        api={fakeApi([NOTES], {
          disconnectConnector: disconnect,
          connectorPulled: async () => ({ count: 2 }),
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await screen.findByText(/2 facts in your Library came from it/u);
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect and forget them' }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith(NOTES.id, true));
    await waitFor(() =>
      expect(screen.getByText(/2 facts it had pulled were forgotten/u)).toBeTruthy(),
    );
  });

  it('removes a connector only after a second, explicit step, and can keep what it pulled', async () => {
    const remove = vi.fn(async () => ({
      outcome: { removed: true, revocation: 'revoked' as const },
    }));
    render(<ConnectorsView api={fakeApi([NOTES], { removeConnector: remove })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await screen.findByRole('button', { name: 'Yes, remove' });
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(NOTES.id, false));
  });

  it('shows the owner how to handle a partial removal', async () => {
    const reason =
      'The connector was removed. Its case-action settings could not be cleared. Stop every agent using this state directory and follow the case-request recovery instructions in the Personal Agent guide.';
    const remove = vi.fn(async () => {
      throw new Error(reason);
    });
    render(<ConnectorsView api={fakeApi([NOTES], { removeConnector: remove })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, remove' }));
    expect(await screen.findByText(reason)).toBeTruthy();
  });

  it('turns keeping the library up to date on, off and runs it now', async () => {
    const setSync = vi.fn(async () => ({ connector: NOTES }));
    const run = vi.fn(async () => ({}));
    const synced: IConnectorView = {
      ...NOTES,
      sync: {
        goalId: 'goal-1',
        everyMinutes: 60,
        status: 'active',
        lastRunAt: '2026-11-15T01:00:00Z',
        nextRunAt: '2026-11-15T02:00:00Z',
      },
    };
    render(
      <ConnectorsView api={fakeApi([synced], { setConnectorSync: setSync, goalAction: run })} />,
    );
    const choose = await screen.findByLabelText('How often to check Notes');
    expect((choose as HTMLSelectElement).value).toBe('60');
    fireEvent.change(choose, { target: { value: '15' } });
    await waitFor(() => expect(setSync).toHaveBeenCalledWith(NOTES.id, 15));
    fireEvent.change(choose, { target: { value: 'off' } });
    await waitFor(() => expect(setSync).toHaveBeenCalledWith(NOTES.id, null));
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('goal-1', 'run'));
    expect(screen.getByText(/cannot change anything at the service/u)).toBeTruthy();
  });

  it('says when a check is paused or going on, instead of showing a time that will not come', async () => {
    const sync = {
      goalId: 'goal-1',
      everyMinutes: 60,
      lastRunAt: '2026-11-15T01:00:00Z',
      nextRunAt: '2026-11-15T02:00:00Z',
    } as const;
    const { unmount } = render(
      <ConnectorsView api={fakeApi([{ ...NOTES, sync: { ...sync, status: 'paused' } }])} />,
    );
    await screen.findByText(/Paused in your Goals/u);
    unmount();
    render(<ConnectorsView api={fakeApi([{ ...NOTES, sync: { ...sync, status: 'running' } }])} />);
    await screen.findByText(/Checking now\./u);
  });

  it('offers sync only for a connected service', async () => {
    const idle: IConnectorView = { ...NOTES, status: { state: 'not-connected' }, tools: undefined };
    render(<ConnectorsView api={fakeApi([idle])} />);
    await screen.findByRole('button', { name: 'Connect' });
    expect(screen.queryByLabelText('How often to check Notes')).toBeNull();
  });

  it('keeps the reason an action was refused on the page, instead of wiping it with the reload after it', async () => {
    const add = vi.fn(async () => {
      throw new Error('This looks like a secret and is not kept as a name');
    });
    render(<ConnectorsView api={fakeApi([], { addConnector: add })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'sk-proj-abc' } });
    fireEvent.change(screen.getByLabelText('Address of the service'), {
      target: { value: 'https://mail.example/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText(/looks like a secret/u);
    // The form stays open for the person to correct, and the reason is still there after the reload.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(/looks like a secret/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('asks the service for a long-lasting sign-in only when the person chooses it', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([], { addConnector: add })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work mail' } });
    fireEvent.change(screen.getByLabelText('Address of the service'), {
      target: { value: 'https://mail.example/mcp' },
    });
    fireEvent.click(screen.getByLabelText(/Ask the service for a long-lasting sign-in/u));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Work mail',
        kind: 'mail',
        endpoint: 'https://mail.example/mcp',
        authorizationParams: { access_type: 'offline', prompt: 'consent' },
      }),
    );
  });

  it('adds a service that takes a token with its header, and leaves out what only a sign-in page needs, even when it was typed first', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([], { addConnector: add })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tracker' } });
    fireEvent.change(screen.getByLabelText('Address of the service'), {
      target: { value: 'https://tracker.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('Client id you registered (optional)'), {
      target: { value: 'my-client' },
    });
    fireEvent.change(screen.getByLabelText('How it signs you in'), { target: { value: 'token' } });
    // The OAuth fields and the redirect address are gone once the person picks a token.
    expect(screen.queryByLabelText('Client id you registered (optional)')).toBeNull();
    expect(screen.queryByText(`${window.location.origin}/connector-callback`)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Header the token goes in/u), {
      target: { value: ' X-Api-Key ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Tracker',
        kind: 'mail',
        endpoint: 'https://tracker.example/mcp',
        auth: 'token',
        tokenHeader: 'X-Api-Key',
      }),
    );
  });

  it('adds a service that needs no sign-in with nothing about signing in', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([], { addConnector: add })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Open notes' } });
    fireEvent.change(screen.getByLabelText('Address of the service'), {
      target: { value: 'https://open.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('How it signs you in'), { target: { value: 'none' } });
    expect(screen.queryByLabelText(/Header the token goes in/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Open notes',
        kind: 'mail',
        endpoint: 'https://open.example/mcp',
        auth: 'none',
      }),
    );
  });

  it('adds a connector, shows the redirect address a registered client needs, and splits the scopes', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([], { addConnector: add })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    expect(screen.getByText(`${window.location.origin}/connector-callback`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Work mail' } });
    fireEvent.change(screen.getByLabelText('What it is'), { target: { value: 'mail' } });
    fireEvent.change(screen.getByLabelText('Address of the service'), {
      target: { value: 'https://mail.example/mcp' },
    });
    fireEvent.change(screen.getByLabelText('Client id you registered (optional)'), {
      target: { value: ' my-client ' },
    });
    fireEvent.change(screen.getByLabelText(/Scopes to ask for/u), {
      target: { value: 'mail.read  mail.labels' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Work mail',
        kind: 'mail',
        endpoint: 'https://mail.example/mcp',
        clientId: 'my-client',
        scopes: ['mail.read', 'mail.labels'],
      }),
    );
  });
});

describe('what the agent should ask the person about', () => {
  const WORDS_LABEL = 'What should I ask you about?';

  it('shows the default words until the person writes their own, then saves them as plain text', async () => {
    const save = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([NOTES], { setConnectorAttention: save })} />);
    const field = (await screen.findByLabelText(WORDS_LABEL)) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe(DEFAULT_WORDS);
    expect(field.maxLength).toBe(600);
    expect(screen.getByText(/These are the default words for notes/u)).toBeTruthy();
    // Nothing to save while the words are the ones already in force.
    const keep = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(keep.disabled).toBe(true);

    fireEvent.change(field, { target: { value: 'Only ask me about <b>my landlord</b>.' } });
    expect(keep.disabled).toBe(false);
    fireEvent.click(keep);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(NOTES.id, 'Only ask me about <b>my landlord</b>.'),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Saved. The next check uses these words.',
      ),
    );
    // What was typed is text, never markup.
    expect(field.value).toBe('Only ask me about <b>my landlord</b>.');
    expect(document.querySelector('b')).toBeNull();
  });

  it('shows the person’s own words when they wrote some, and goes back to the default on request', async () => {
    const own: IConnectorView = { ...NOTES, attention: 'Only my landlord.' };
    const save = vi.fn(async () => ({ connector: NOTES }));
    render(<ConnectorsView api={fakeApi([own], { setConnectorAttention: save })} />);
    const field = (await screen.findByLabelText(WORDS_LABEL)) as HTMLTextAreaElement;
    expect(field.value).toBe('Only my landlord.');
    expect(screen.getByText(/These are your own words\./u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use the default words for Notes' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(NOTES.id, ''));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Back to the default words.'),
    );
    expect(field.value).toBe(DEFAULT_WORDS);
  });

  it('says why the agent refused the words, beside the buttons, and keeps what was typed', async () => {
    const save = vi.fn(async () => {
      throw new Error('This text looks like it contains a secret value, so it is not kept');
    });
    render(<ConnectorsView api={fakeApi([NOTES], { setConnectorAttention: save })} />);
    const field = (await screen.findByLabelText(WORDS_LABEL)) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: 'Ask me about password=hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/contains a secret value/u),
    );
    expect(field.value).toBe('Ask me about password=hunter2');
    // Said once, in the editor: not also as a refusal of the whole page.
    expect(screen.getAllByText(/contains a secret value/u)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    // Typing again clears the old verdict.
    fireEvent.change(field, { target: { value: 'Ask me about my landlord' } });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('keeps what is being typed when the list reloads, and shows a change made elsewhere once nothing is unsaved', async () => {
    const synced: IConnectorView = {
      ...NOTES,
      sync: { goalId: 'goal-1', everyMinutes: 60, status: 'active' },
    };
    let current: IConnectorView = synced;
    const api = {
      connectors: async () => ({ callbackPath: '/connector-callback', connectors: [current] }),
      connectorPulled: async () => ({ count: 0 }),
      fenceCaseActionRequests: async () => ({
        fenced: [NOTES.id],
        callbackPath: '/connector-callback',
        connectors: [current],
      }),
      goalAction: async () => ({}),
    } as unknown as IPersonalApi;
    render(<ConnectorsView api={api} />);
    const field = (await screen.findByLabelText(WORDS_LABEL)) as HTMLTextAreaElement;
    const reload = async (): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
      await screen.findByText(/Queued\./u);
      // The click reloads once its request is done; wait for that to settle.
      await new Promise((resolve) => setTimeout(resolve, 20));
    };

    fireEvent.change(field, { target: { value: 'Half-written words' } });
    current = { ...synced, attention: 'Written on another device.' };
    await reload();
    expect(field.value).toBe('Half-written words');

    // Back to the words the page last showed: nothing is unsaved now, so a change made elsewhere shows.
    fireEvent.change(field, { target: { value: 'Written on another device.' } });
    current = { ...synced, attention: 'Changed once more.' };
    await reload();
    await waitFor(() => expect(field.value).toBe('Changed once more.'));
  });

  it('is offered only for a connected service, where a check can run', async () => {
    const idle: IConnectorView = { ...NOTES, status: { state: 'not-connected' }, tools: undefined };
    render(<ConnectorsView api={fakeApi([idle])} />);
    await screen.findByRole('button', { name: 'Connect' });
    expect(screen.queryByLabelText(WORDS_LABEL)).toBeNull();
  });
});

describe('finding a service to add', () => {
  const FOUND: IConnectorCatalogView = {
    registry: 'ok',
    entries: [
      {
        title: 'Example notes',
        endpoint: 'https://notes.example.test/mcp',
        kind: 'notes',
        auth: 'token',
        tokenHeader: 'X-Api-Key',
        description: 'Find and file notes',
        source: 'registry',
      },
      {
        title: 'Team calendar',
        endpoint: 'https://calendar.example.test/mcp',
        kind: 'calendar',
        auth: 'oauth',
        source: 'file',
      },
    ],
  };

  async function openAddForm(extra: Partial<IPersonalApi>) {
    render(<ConnectorsView api={fakeApi([], extra)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
  }

  it('shows what a search found, and choosing one only fills in the form until the person adds it', async () => {
    const search = vi.fn(async () => FOUND);
    const add = vi.fn(async () => ({ connector: NOTES }));
    await openAddForm({ connectorCatalog: search, addConnector: add });
    fireEvent.change(screen.getByLabelText('Search for a service'), { target: { value: 'notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Example notes');
    expect(search).toHaveBeenCalledWith('notes');
    expect(
      screen.getByText(/notes\.example\.test · Paste a token or API key · public registry/u),
    ).toBeTruthy();
    expect(screen.getByText(/calendar\.example\.test · .* · your list/u)).toBeTruthy();
    expect(screen.getByText(/check that you trust one before you add it/u)).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[0]!);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Example notes');
    expect((screen.getByLabelText('Address of the service') as HTMLInputElement).value).toBe(
      'https://notes.example.test/mcp',
    );
    expect((screen.getByLabelText('How it signs you in') as HTMLSelectElement).value).toBe('token');
    expect((screen.getByLabelText(/Header the token goes in/u) as HTMLInputElement).value).toBe(
      'X-Api-Key',
    );
    // Nothing is added by choosing.
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Example notes',
        kind: 'notes',
        endpoint: 'https://notes.example.test/mcp',
        auth: 'token',
        tokenHeader: 'X-Api-Key',
      }),
    );
  });

  it('sends the name the person edited after choosing a suggestion, not the suggested one', async () => {
    const search = vi.fn(async () => FOUND);
    const add = vi.fn(async () => ({ connector: NOTES }));
    await openAddForm({ connectorCatalog: search, addConnector: add });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Example notes');
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[0]!);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Example notes');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'My notes',
        kind: 'notes',
        endpoint: 'https://notes.example.test/mcp',
        auth: 'token',
        tokenHeader: 'X-Api-Key',
      }),
    );
  });

  it('searches on Enter without adding anything, and clears what a previous choice filled that belongs to another sign-in', async () => {
    const search = vi.fn(async () => FOUND);
    const add = vi.fn(async () => ({ connector: NOTES }));
    await openAddForm({ connectorCatalog: search, addConnector: add });
    fireEvent.change(screen.getByLabelText('Client id you registered (optional)'), {
      target: { value: 'my-client' },
    });
    fireEvent.change(screen.getByLabelText('Search for a service'), { target: { value: 'cal' } });
    // The key press is cancelled, so the browser does not submit the form below and add something.
    expect(fireEvent.keyDown(screen.getByLabelText('Search for a service'), { key: 'Enter' })).toBe(
      false,
    );
    await screen.findByText('Team calendar');
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[1]!);
    expect(
      (screen.getByLabelText('Client id you registered (optional)') as HTMLInputElement).value,
    ).toBe('');
  });

  it('says so when the registry could not be reached, when nothing was found, and when the search failed', async () => {
    const { unmount } = render(
      <ConnectorsView
        api={fakeApi([], {
          connectorCatalog: async () => ({ ...FOUND, registry: 'unreachable' }),
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/public registry could not be reached/u);
    unmount();

    const empty = render(
      <ConnectorsView
        api={fakeApi([], { connectorCatalog: async () => ({ registry: 'ok', entries: [] }) })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/Nothing found/u);
    empty.unmount();

    render(
      <ConnectorsView
        api={fakeApi([], {
          connectorCatalog: async () => {
            throw new Error('The agent is not reachable');
          },
        })}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add a connector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('The agent is not reachable');
  });

  it('names the words the results are for, and drops an answer that arrives after a newer search', async () => {
    let release!: (view: IConnectorCatalogView) => void;
    const slow = new Promise<IConnectorCatalogView>((resolve) => {
      release = resolve;
    });
    const search = vi
      .fn<(query: string) => Promise<IConnectorCatalogView>>()
      .mockImplementationOnce(() => slow)
      .mockImplementationOnce(async () => FOUND);
    await openAddForm({ connectorCatalog: search });
    const field = screen.getByLabelText('Search for a service');
    fireEvent.change(field, { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(field, { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Results for “new”');
    // The first answer comes back last and is not shown over the newer one.
    release({
      registry: 'ok',
      entries: [
        {
          title: 'Stale answer',
          endpoint: 'https://stale.example.test/mcp',
          kind: 'other',
          auth: 'oauth',
          source: 'registry',
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText('Stale answer')).toBeNull();
    expect(screen.getByText('Example notes')).toBeTruthy();
  });

  const SHIPPED: IConnectorCatalogView = {
    registry: 'off',
    entries: [
      {
        title: 'Shipped mail',
        endpoint: 'https://mail.example.test/mcp',
        kind: 'mail',
        auth: 'oauth',
        source: 'file',
        oauth: {
          clientId: 'shipped-client',
          scopes: ['mail.read', 'mail.labels'],
          authorizationParams: { access_type: 'offline', prompt: 'consent' },
        },
      },
      {
        title: 'Shipped files',
        endpoint: 'https://files.example.test/mcp',
        kind: 'files',
        auth: 'oauth',
        source: 'file',
        oauth: { clientId: 'files-client', authorizationParams: { audience: 'files' } },
      },
      {
        title: 'Plain notes',
        endpoint: 'https://plain.example.test/mcp',
        kind: 'notes',
        auth: 'oauth',
        source: 'file',
      },
    ],
  };

  it('fills in the client, scopes and long-lasting sign-in a suggestion brings, and adds them as typed', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    await openAddForm({ connectorCatalog: async () => SHIPPED, addConnector: add });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Shipped mail');
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[0]!);
    expect(
      (screen.getByLabelText('Client id you registered (optional)') as HTMLInputElement).value,
    ).toBe('shipped-client');
    expect((screen.getByLabelText(/Scopes to ask for/u) as HTMLInputElement).value).toBe(
      'mail.read mail.labels',
    );
    expect(
      (screen.getByLabelText(/Ask the service for a long-lasting sign-in/u) as HTMLInputElement)
        .checked,
    ).toBe(true);
    // The long-lasting choice stands for those two options, so nothing else is announced.
    expect(screen.queryByText(/This suggestion also asks the service for/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Shipped mail',
        kind: 'mail',
        endpoint: 'https://mail.example.test/mcp',
        clientId: 'shipped-client',
        scopes: ['mail.read', 'mail.labels'],
        authorizationParams: { access_type: 'offline', prompt: 'consent' },
      }),
    );
  });

  it('shows any other sign-in option a suggestion brings before it is sent, and clears it when another is chosen', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    await openAddForm({ connectorCatalog: async () => SHIPPED, addConnector: add });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Shipped files');
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[1]!);
    await screen.findByText('audience=files');
    expect(
      (screen.getByLabelText(/Ask the service for a long-lasting sign-in/u) as HTMLInputElement)
        .checked,
    ).toBe(false);
    // A later choice that brings no client leaves nothing of the earlier one behind.
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[2]!);
    expect(screen.queryByText('audience=files')).toBeNull();
    expect(
      (screen.getByLabelText('Client id you registered (optional)') as HTMLInputElement).value,
    ).toBe('');
    // Choosing the first again brings its option back, and it is sent as shown.
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[1]!);
    await screen.findByText('audience=files');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({
        title: 'Shipped files',
        kind: 'files',
        endpoint: 'https://files.example.test/mcp',
        clientId: 'files-client',
        authorizationParams: { audience: 'files' },
      }),
    );
  });

  it('sends the options the note names together with the long-lasting pair when the person ticks it', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    await openAddForm({ connectorCatalog: async () => SHIPPED, addConnector: add });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Shipped files');
    fireEvent.click(screen.getAllByRole('button', { name: 'Use' })[1]!);
    await screen.findByText('audience=files');
    fireEvent.click(screen.getByLabelText(/Ask the service for a long-lasting sign-in/u));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizationParams: { audience: 'files', access_type: 'offline', prompt: 'consent' },
        }),
      ),
    );
  });

  it('lets what the note names win over the long-lasting pair when they name the same option', async () => {
    const add = vi.fn(async () => ({ connector: NOTES }));
    const conflicting: IConnectorCatalogView = {
      registry: 'off',
      entries: [
        {
          title: 'Online only',
          endpoint: 'https://online.example.test/mcp',
          kind: 'other',
          auth: 'oauth',
          source: 'file',
          oauth: { clientId: 'online-client', authorizationParams: { access_type: 'online' } },
        },
      ],
    };
    await openAddForm({ connectorCatalog: async () => conflicting, addConnector: add });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Online only');
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await screen.findByText('access_type=online');
    fireEvent.click(screen.getByLabelText(/Ask the service for a long-lasting sign-in/u));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizationParams: { access_type: 'online', prompt: 'consent' },
        }),
      ),
    );
  });

  it('shows a suggestion’s words as plain text, whatever they contain', async () => {
    const hostile: IConnectorCatalogView = {
      registry: 'ok',
      entries: [
        {
          title: 'Looks fine',
          endpoint: 'https://notes.example.test/mcp',
          kind: 'other',
          auth: 'oauth',
          description: '<img src=x onerror=alert(1)><script>alert(2)</script>',
          source: 'registry',
        },
      ],
    };
    await openAddForm({ connectorCatalog: async () => hostile });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText(/<script>alert\(2\)<\/script>/u);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('the connector calls of the API client', () => {
  it('use the connector routes and encode ids and tool names', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const api = createPersonalApi(async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await api.connectors();
    await api.connectorCatalog('mail & notes');
    await api.connectConnector('connector-a', { origin: 'https://agent.example' });
    await api.connectConnector('connector-a', { token: 'typed-token' });
    await api.replaceConnectorToken('connector-a', 'next-token');
    await api.disconnectConnector('connector-a', true);
    await api.removeConnector('connector-a');
    await api.connectorPulled('connector-a');
    await api.setConnectorSync('connector-a', 60);
    await api.setConnectorAttention('connector-a', 'Only my landlord.');
    await api.decideConnectorTool('connector-a', 'tool/with space', null);
    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET api/connectors',
      'GET api/connectors/catalog?query=mail%20%26%20notes',
      'POST api/connectors/connector-a/connect',
      'POST api/connectors/connector-a/connect',
      'POST api/connectors/connector-a/token',
      'POST api/connectors/connector-a/disconnect',
      'POST api/connectors/connector-a/remove',
      'GET api/connectors/connector-a/pulled',
      'POST api/connectors/connector-a/sync',
      'PUT api/connectors/connector-a/attention',
      'POST api/connectors/connector-a/tools/tool%2Fwith%20space',
    ]);
    expect(calls[2]!.init?.body).toBe(JSON.stringify({ origin: 'https://agent.example' }));
    // A token sign-in never comes back to this page, so it carries no origin.
    expect(calls[3]!.init?.body).toBe(JSON.stringify({ token: 'typed-token' }));
    expect(calls[4]!.init?.body).toBe(JSON.stringify({ token: 'next-token' }));
    expect(calls[5]!.init?.body).toBe(JSON.stringify({ forgetPulled: true }));
    expect(calls[6]!.init?.body).toBe(JSON.stringify({ forgetPulled: false }));
    expect(calls[8]!.init?.body).toBe(JSON.stringify({ everyMinutes: 60 }));
    // The words go as a write the server accepts: the write header and JSON.
    expect(calls[9]!.init?.body).toBe(JSON.stringify({ text: 'Only my landlord.' }));
    expect(calls[9]!.init?.headers).toEqual({
      'content-type': 'application/json',
      [API_WRITE_HEADER]: '1',
    });
    expect(calls[10]!.init?.body).toBe(JSON.stringify({ decision: null }));
  });
});
