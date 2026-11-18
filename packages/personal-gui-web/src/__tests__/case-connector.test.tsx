// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { CaseConnector } from '../views/CaseConnector.js';
import { CaseThread } from '../views/CaseThread.js';
import { FeedView } from '../views/Feed.js';

import type {
  ICaseConnectorBinding,
  ICaseView,
  IConnectorView,
  IFeedItemView,
  IPersonalApi,
} from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const MAIL = {
  id: 'connector-mail',
  title: 'Mail',
  kind: 'mail',
  endpoint: 'https://mail.example/mcp',
} as IConnectorView;
const NOTES = {
  id: 'connector-notes',
  title: 'Notes',
  kind: 'notes',
  endpoint: 'https://notes.example/mcp',
} as IConnectorView;
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
    connectorInventory: async () => ({
      callbackPath: '/connector-callback',
      connectors: [MAIL, NOTES],
    }),
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

  it('does not let an older inventory response overwrite a strict-mode reload', async () => {
    const fake = fakeApi();
    let release!: (value: { callbackPath: string; connectors: readonly IConnectorView[] }) => void;
    const first = new Promise<{ callbackPath: string; connectors: readonly IConnectorView[] }>(
      (resolve) => {
        release = resolve;
      },
    );
    let calls = 0;
    fake.api.connectorInventory = async () =>
      ++calls === 1 ? first : { callbackPath: '/connector-callback', connectors: [NOTES] };
    render(
      <React.StrictMode>
        <CaseConnector api={fake.api} caseId={THREAD.id} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(select().disabled).toBe(false));
    expect([...select().options].map((item) => item.value)).toEqual(['', NOTES.id]);
    await act(async () => {
      release({ callbackPath: '/connector-callback', connectors: [MAIL] });
      await first;
    });
    expect([...select().options].map((item) => item.value)).toEqual(['', NOTES.id]);
  });

  it('shows an inventory failure and retries without service discovery', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi();
    const inventory = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        callbackPath: '/connector-callback',
        connectors: [MAIL],
      });
    fake.api.connectorInventory = inventory;
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    await screen.findByText(/The service list could not be loaded/u);
    expect(select().disabled).toBe(true);
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await waitFor(() => expect(select().disabled).toBe(false));
    expect(inventory).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/The service list could not be loaded/u)).toBeNull();
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

  it('distinguishes services with the same name by their endpoint', async () => {
    const fake = fakeApi();
    const personal = {
      ...NOTES,
      id: 'connector-personal',
      endpoint: 'https://personal.example/mcp',
    };
    const work = { ...NOTES, id: 'connector-work', endpoint: 'https://work.example/mcp' };
    fake.api.connectorInventory = async () => ({
      callbackPath: '/connector-callback',
      connectors: [personal, work],
    });
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    await waitFor(() => expect(select().disabled).toBe(false));
    expect(screen.getByRole('option', { name: /personal\.example\/mcp/u })).toBeTruthy();
    expect(screen.getByRole('option', { name: /work\.example\/mcp/u })).toBeTruthy();
  });

  it('removes an existing choice even while the connector list is stalled', async () => {
    const fake = fakeApi({ revision: 'revision-1', connectorId: MAIL.id });
    fake.api.connectorInventory = () => new Promise(() => undefined);
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

  it('explains how to retry a removal fenced by another page', async () => {
    const fake = fakeApi({ revision: 'revision-1', connectorId: MAIL.id });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.api.setCaseConnector = async (_id, connectorId, revision) => {
      await gate;
      return fake.update(connectorId, revision);
    };
    render(<CaseConnector api={fake.api} caseId={THREAD.id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove choice' }));
    await act(async () => {
      await fake.fenceCaseConnector(THREAD.id, 'revision-2');
      release();
      await gate;
    });
    await screen.findByText(
      'The choice is still selected. Review it and choose Remove choice again.',
    );
    expect(fake.read().connectorId).toBe(MAIL.id);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice' }));
    await waitFor(() => expect(fake.read().connectorId).toBeUndefined());
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

  it('keeps a draft when another page only fences the same choice', async () => {
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
    await fake.fenceCaseConnector(THREAD.id, fake.read().revision);
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    expect(select().value).toBe(NOTES.id);
    expect(screen.queryByText(/This choice changed in another page/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    await waitFor(() => expect(fake.read().connectorId).toBe(NOTES.id));
  });

  it('marks a stale choice unconfirmed and lets the person remove the newer choice', async () => {
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
    fake.update(MAIL.id, fake.read().revision);
    fake.api.caseConnector = async () => {
      throw new Error('offline');
    };
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await screen.findByText(/The current choice cannot be confirmed/u);
    expect(select().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice' }));
    await screen.findByText(
      'The choice is still selected. Review it and choose Remove choice again.',
    );
    await waitFor(() => expect(select().value).toBe(MAIL.id));
    expect(fake.read().connectorId).toBe(MAIL.id);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice' }));
    await waitFor(() => expect(fake.read().connectorId).toBeUndefined());
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

  it('keeps a case reachable for removal after its feed card is dismissed', async () => {
    const fake = fakeApi({ revision: 'revision-1', connectorId: MAIL.id });
    let items: readonly IFeedItemView[] = [
      {
        id: 'feed-1',
        at: THREAD.createdAt,
        kind: 'question',
        title: THREAD.title,
        body: 'A note',
        question: {
          caseId: THREAD.id,
          text: 'Continue?',
          options: ['Yes'],
          allowsReply: false,
          state: 'answered',
          answer: { choice: 'Yes', at: THREAD.createdAt },
        },
      },
    ];
    fake.api.feed = async () => items;
    fake.api.answerFeed = async () => {
      items = [];
      return {};
    };
    fake.api.cases = async () => [THREAD];
    render(<FeedView api={fake.api} onOpenGoal={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await screen.findByText(/Nothing new/u);
    fireEvent.click(screen.getByRole('button', { name: 'View cases' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open case: A case (case-1)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove choice' }));
    await waitFor(() => expect(fake.read().connectorId).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: 'Back to cases' }));
    expect(await screen.findByRole('button', { name: 'Open case: A case (case-1)' })).toBeTruthy();
  });

  it('does not reopen a case from an older delayed response', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi();
    let release!: (value: ICaseView) => void;
    const first = new Promise<ICaseView>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    fake.api.caseThread = async () => (++calls === 1 ? first : { ...THREAD, state: 'closed' });
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await screen.findByText(/Closed · opened/u);
    await act(async () => {
      release(THREAD);
      await first;
    });
    expect(screen.getByText(/Closed · opened/u)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Service for this case' })).toBeNull();
  });

  it('keeps a confirmed closed case closed when a newer request returns an older view', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi();
    let close!: (value: ICaseView) => void;
    let oldOpen!: (value: ICaseView) => void;
    const first = new Promise<ICaseView>((resolve) => {
      close = resolve;
    });
    const second = new Promise<ICaseView>((resolve) => {
      oldOpen = resolve;
    });
    let calls = 0;
    fake.api.caseThread = async () => (++calls === 1 ? first : second);
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await act(async () => {
      close({ ...THREAD, state: 'closed' });
      await first;
    });
    await screen.findByText(/Closed · opened/u);
    await act(async () => {
      oldOpen(THREAD);
      await second;
    });
    expect(screen.getByText(/Closed · opened/u)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Service for this case' })).toBeNull();
  });

  it('applies a closed response from an earlier request after a newer open response', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi();
    let close!: (value: ICaseView) => void;
    const first = new Promise<ICaseView>((resolve) => {
      close = resolve;
    });
    let calls = 0;
    fake.api.caseThread = async () => (++calls === 1 ? first : THREAD);
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await screen.findByText(/Open · opened/u);
    await act(async () => {
      close({ ...THREAD, state: 'closed' });
      await first;
    });
    expect(await screen.findByText(/Closed · opened/u)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Service for this case' })).toBeNull();
  });

  it('shows a slow case response while a newer poll is still running', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi();
    let release!: (value: ICaseView) => void;
    const first = new Promise<ICaseView>((resolve) => {
      release = resolve;
    });
    const never = new Promise<ICaseView>(() => undefined);
    let calls = 0;
    fake.api.caseThread = async () => (++calls === 1 ? first : never);
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await act(async () => {
      tick();
      tick();
      await Promise.resolve();
    });
    await act(async () => {
      release(THREAD);
      await first;
    });
    expect(await screen.findByText('A case')).toBeTruthy();
    expect(screen.getByText(/Open · opened/u)).toBeTruthy();
  });

  it('allows removing a choice while the case status cannot be confirmed', async () => {
    let tick!: () => void;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 3_000 && tick === undefined) tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const fake = fakeApi({ revision: 'revision-1', connectorId: MAIL.id });
    let healthy = true;
    fake.api.caseThread = async () => {
      if (!healthy) throw new Error('Case unavailable');
      return THREAD;
    };
    render(<CaseThread api={fake.api} caseId={THREAD.id} onBack={() => undefined} />);
    await screen.findByRole('region', { name: 'Service for this case' });
    healthy = false;
    await act(async () => {
      tick();
      await Promise.resolve();
    });
    await screen.findByText('Case unavailable');
    expect(screen.getByText(/Last known: Open/u)).toBeTruthy();
    expect(select().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove choice' }));
    await waitFor(() => expect(fake.read().connectorId).toBeUndefined());
  });
});
