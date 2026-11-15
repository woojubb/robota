// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPersonalApi } from '../api.js';
import { ConnectorsView } from '../views/Connectors.js';

import type { IConnectorView, IConnectorsListing, IPersonalApi } from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOTES: IConnectorView = {
  id: 'connector-notes-1',
  title: 'Notes',
  kind: 'notes',
  endpoint: 'https://notes.example/mcp',
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
    ...extra,
  } as unknown as IPersonalApi;
}

describe('the Connectors tab', () => {
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
    await waitFor(() => expect(connect).toHaveBeenCalledWith(NOTES.id, window.location.origin));
    expect(open).toHaveBeenCalledWith(
      'https://auth.example/authorize?x=1',
      '_blank',
      'noopener,noreferrer',
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
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(NOTES.id, false));
  });

  it('turns keeping the library up to date on, off and runs it now', async () => {
    const setSync = vi.fn(async () => ({ connector: NOTES }));
    const run = vi.fn(async () => ({}));
    const synced: IConnectorView = {
      ...NOTES,
      sync: {
        goalId: 'goal-1',
        everyMinutes: 60,
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

  it('offers sync only for a connected service', async () => {
    const idle: IConnectorView = { ...NOTES, status: { state: 'not-connected' }, tools: undefined };
    render(<ConnectorsView api={fakeApi([idle])} />);
    await screen.findByRole('button', { name: 'Connect' });
    expect(screen.queryByLabelText('How often to check Notes')).toBeNull();
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

describe('the connector calls of the API client', () => {
  it('use the connector routes and encode ids and tool names', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const api = createPersonalApi(async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await api.connectors();
    await api.connectConnector('connector-a', 'https://agent.example');
    await api.disconnectConnector('connector-a', true);
    await api.removeConnector('connector-a');
    await api.connectorPulled('connector-a');
    await api.setConnectorSync('connector-a', 60);
    await api.decideConnectorTool('connector-a', 'tool/with space', null);
    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET api/connectors',
      'POST api/connectors/connector-a/connect',
      'POST api/connectors/connector-a/disconnect',
      'POST api/connectors/connector-a/remove',
      'GET api/connectors/connector-a/pulled',
      'POST api/connectors/connector-a/sync',
      'POST api/connectors/connector-a/tools/tool%2Fwith%20space',
    ]);
    expect(calls[1]!.init?.body).toBe(JSON.stringify({ origin: 'https://agent.example' }));
    expect(calls[2]!.init?.body).toBe(JSON.stringify({ forgetPulled: true }));
    expect(calls[3]!.init?.body).toBe(JSON.stringify({ forgetPulled: false }));
    expect(calls[5]!.init?.body).toBe(JSON.stringify({ everyMinutes: 60 }));
    expect(calls[6]!.init?.body).toBe(JSON.stringify({ decision: null }));
  });
});
