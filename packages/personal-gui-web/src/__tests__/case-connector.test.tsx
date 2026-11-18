// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { CaseConnector } from '../views/CaseConnector.js';
import { CaseThread } from '../views/CaseThread.js';

import type { ICaseConnectorBinding, ICaseView, IConnectorView, IPersonalApi } from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MAIL = { id: 'connector-mail', title: 'Mail', kind: 'mail' } as IConnectorView;
const NOTES = { id: 'connector-notes', title: 'Notes', kind: 'notes' } as IConnectorView;
const THREAD: ICaseView = {
  id: 'case-1',
  title: 'A case',
  origin: { connectorId: MAIL.id, source: 'message' },
  state: 'open',
  notes: [],
  history: [],
  createdAt: '2026-11-16T01:00:00Z',
  updatedAt: '2026-11-16T01:00:00Z',
};

function fakeApi(initial: ICaseConnectorBinding = { revision: 'revision-1' }) {
  let value = initial;
  let next = 1;
  const update = (connectorId: string | null, revision: string): ICaseConnectorBinding => {
    if (revision !== value.revision || (value.error === true && connectorId !== null)) {
      throw new ApiError(400, 'The setting changed');
    }
    value = { revision: `revision-${++next}`, ...(connectorId !== null && { connectorId }) };
    return value;
  };
  const caseConnector = vi.fn(async () => value);
  const fenceCaseConnector = vi.fn(async (_id: string, revision: string) => {
    if (value.revision === revision) value = { ...value, revision: `revision-${++next}` };
    return value;
  });
  const setCaseConnector = vi.fn(
    async (_id: string, connectorId: string | null, revision: string) =>
      update(connectorId, revision),
  );
  const api = {
    caseThread: async () => THREAD,
    caseConnector,
    fenceCaseConnector,
    setCaseConnector,
    connectors: async () => ({ callbackPath: '/connector-callback', connectors: [MAIL, NOTES] }),
  } as unknown as IPersonalApi;
  return { api, caseConnector, fenceCaseConnector, setCaseConnector, update, read: () => value };
}

const select = (): HTMLSelectElement => screen.getByLabelText('Service') as HTMLSelectElement;

describe('the case service choice', () => {
  it('opens the settings after a strict-mode effect is restarted', async () => {
    const fake = fakeApi();
    let release!: (value: ICaseConnectorBinding) => void;
    const first = new Promise<ICaseConnectorBinding>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    fake.api.caseConnector = async () => (++calls === 1 ? first : fake.read());
    render(
      <React.StrictMode>
        <CaseConnector api={fake.api} caseId={THREAD.id} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(select().disabled).toBe(false));
    await act(async () => {
      release({ revision: 'revision-1' });
      await first;
    });
    expect(select().value).toBe('');
  });

  it('does not select a connector from case content; saves only the choice the person makes', async () => {
    const fake = fakeApi();
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await screen.findByRole('region', { name: 'Service for this case' });
    await waitFor(() => expect(select().disabled).toBe(false));
    expect(select().value).toBe('');
    expect(fake.setCaseConnector).not.toHaveBeenCalled();
    fireEvent.change(select(), { target: { value: NOTES.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    await waitFor(() => expect(fake.setCaseConnector).toHaveBeenCalledTimes(1));
    expect(fake.setCaseConnector).toHaveBeenCalledWith(
      THREAD.id,
      NOTES.id,
      'revision-2',
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(fake.read().connectorId).toBe(NOTES.id));
  });

  it('removes an existing choice even while the connector list is stalled', async () => {
    const fake = fakeApi({ revision: 'revision-1', connectorId: MAIL.id });
    fake.api.connectors = () => new Promise(() => undefined);
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove choice' }));
    await waitFor(() =>
      expect(fake.setCaseConnector).toHaveBeenCalledWith(
        THREAD.id,
        null,
        'revision-2',
        expect.any(AbortSignal),
      ),
    );
    expect(fake.read().connectorId).toBeUndefined();
  });

  it('fences a delayed choice when the person cancels it', async () => {
    const fake = fakeApi();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = vi.fn(async (_id: string, connectorId: string | null, revision: string) => {
      await gate;
      return fake.update(connectorId, revision);
    });
    fake.api.setCaseConnector = delayed;
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    await waitFor(() => expect(select().disabled).toBe(false));
    fireEvent.change(select(), { target: { value: MAIL.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    await waitFor(() => expect(delayed).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending choice' }));
    await waitFor(() => expect(fake.fenceCaseConnector).toHaveBeenCalledTimes(2));
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => expect(select().disabled).toBe(false));
    expect(select().value).toBe('');
    expect(fake.read().connectorId).toBeUndefined();
  });

  it('shows a choice that had already committed before cancellation', async () => {
    const fake = fakeApi();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.api.setCaseConnector = async (_id, connectorId, revision) => {
      const committed = fake.update(connectorId, revision);
      await gate;
      return committed;
    };
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    await waitFor(() => expect(select().disabled).toBe(false));
    fireEvent.change(select(), { target: { value: MAIL.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    await waitFor(() => expect(fake.read().connectorId).toBe(MAIL.id));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel pending choice' }));
    expect(
      await screen.findByText(
        'The choice was already saved or changed in another page. Review it below.',
      ),
    ).toBeTruthy();
    expect(select().value).toBe(MAIL.id);
    expect(screen.getByRole('button', { name: 'Remove choice' })).toBeTruthy();
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it('shows the actual choice if a saved response is lost', async () => {
    const fake = fakeApi();
    fake.api.setCaseConnector = async (_id, connectorId, revision) => {
      fake.update(connectorId, revision);
      throw new Error('The response was lost');
    };
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    await waitFor(() => expect(select().disabled).toBe(false));
    fireEvent.change(select(), { target: { value: MAIL.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    await screen.findByText('The response was lost');
    await waitFor(() => expect(select().value).toBe(MAIL.id));
    expect(fake.read().connectorId).toBe(MAIL.id);
  });

  it('discards an unsaved draft when another page changes the choice', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi();
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    await waitFor(() => expect(select().disabled).toBe(false));
    fireEvent.change(select(), { target: { value: NOTES.id } });
    fake.update(MAIL.id, fake.read().revision);
    await act(async () => {
      tick();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      await screen.findByText('This choice changed in another page. Choose again before saving.'),
    ).toBeTruthy();
    expect(select().value).toBe(MAIL.id);
    expect(fake.setCaseConnector).not.toHaveBeenCalled();
  });

  it('lets the person explicitly reset a damaged setting', async () => {
    const fake = fakeApi({ revision: 'broken:token', error: true });
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove choice' }));
    await waitFor(() =>
      expect(fake.setCaseConnector).toHaveBeenCalledWith(
        THREAD.id,
        null,
        'broken:token',
        expect.any(AbortSignal),
      ),
    );
    expect(fake.fenceCaseConnector).not.toHaveBeenCalled();
  });

  it('does not offer choices for a closed case', async () => {
    const fake = fakeApi();
    fake.api.caseThread = async () => ({ ...THREAD, state: 'closed' });
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await screen.findByText(/Closed · opened/u);
    expect(screen.queryByRole('region', { name: 'Service for this case' })).toBeNull();
    expect(fake.caseConnector).not.toHaveBeenCalled();
  });
});
