// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { FeedView } from '../views/Feed.js';

import type { ICaseView, IFeedItemView, IFeedQuestionView, IPersonalApi } from '../api.js';

afterEach(cleanup);

const QUESTION: IFeedQuestionView = {
  caseId: 'case-1',
  text: 'Did you sign in just now?',
  options: ['Yes, it was me', 'No'],
  allowsReply: false,
  state: 'open',
};

/** What a mail can plant in a note: Markdown that would become a clickable link if it were formatted. */
const PLANTED = '[Verify your sign-in](https://evil.example/login)';

const OPEN_THREAD = 'Open thread: New sign-in to your account';

const card = (question: IFeedQuestionView = QUESTION): IFeedItemView => ({
  id: 'feed-1',
  at: '2026-11-16T01:00:00Z',
  kind: 'question',
  title: 'New sign-in to your account',
  body: `- A mail says a **new sign-in** happened from Seoul at 10:02.\n- ${PLANTED}`,
  question,
});

const THREAD: ICaseView = {
  id: 'case-1',
  title: 'New sign-in to your account',
  origin: { connectorId: 'connector-mail-1', source: 'mail:message-1' },
  state: 'open',
  notes: [],
  question: {
    text: 'Did you sign in just now?',
    options: ['Yes, it was me', 'No'],
    allowsReply: false,
    askedAt: '2026-11-16T01:00:02Z',
    feedItemId: 'feed-1',
  },
  history: [
    {
      at: '2026-11-16T01:00:00Z',
      kind: 'observed',
      text: `A mail says a **new sign-in** happened. ${PLANTED}`,
    },
    {
      at: '2026-11-16T01:00:01Z',
      kind: 'noted',
      text: 'The address is the usual one. [See the report](https://evil.example/report)',
    },
    { at: '2026-11-16T01:00:02Z', kind: 'asked', text: 'Did you sign in just now?' },
  ],
  createdAt: '2026-11-16T01:00:00Z',
  updatedAt: '2026-11-16T01:00:02Z',
};

/** A feed the test can answer in: answering turns the card into an answered one, as the agent would. */
function fakeApi(extra: Partial<IPersonalApi> = {}, item: IFeedItemView = card()) {
  let items = [item];
  const answerQuestion = vi.fn(
    async (id: string, answer: { choice: string } | { reply: string }) => {
      items = items.map((entry) =>
        entry.id === id && entry.question !== undefined
          ? {
              ...entry,
              question: {
                ...entry.question,
                state: 'answered' as const,
                answer: { ...answer, at: '2026-11-16T02:00:00Z' },
              },
            }
          : entry,
      );
      return { item: items[0]!, case: THREAD };
    },
  );
  const api = {
    feed: async () => items,
    answerQuestion,
    caseThread: async () => THREAD,
    answerFeed: vi.fn(async () => ({})),
    ...extra,
  } as unknown as IPersonalApi;
  return { api, answerQuestion };
}

const view = (api: IPersonalApi) => render(<FeedView api={api} onOpenGoal={() => undefined} />);

describe('a question in the feed', () => {
  it('shows the notes that came with it as plain text with no clickable link, the question, and a button per choice', async () => {
    const { container } = view(fakeApi().api);
    await waitFor(() => expect(screen.getByText('Did you sign in just now?')).toBeTruthy());
    // A link planted in a note stays literal text: nothing in the card can be followed.
    const notes = screen.getByText(/A mail says a \*\*new sign-in\*\*/u);
    expect(notes.tagName).toBe('P');
    expect(notes.textContent).toContain(PLANTED);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Yes, it was me' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No' })).toBeTruthy();
    // Each thread button names its card, so a feed of several tells them apart.
    expect(screen.getByRole('button', { name: OPEN_THREAD })).toBeTruthy();
    // A question that takes no reply has no reply box, and a waiting one is not dismissed unanswered.
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('records the chosen answer, then shows what was answered instead of the choices', async () => {
    const { api, answerQuestion } = fakeApi();
    view(api);
    fireEvent.click(await screen.findByRole('button', { name: 'No' }));
    await waitFor(() => expect(answerQuestion).toHaveBeenCalledWith('feed-1', { choice: 'No' }));
    await waitFor(() => expect(screen.getByText(/You answered: No/u)).toBeTruthy());
    // The clicked button is gone, so the result is announced as a status instead of lost with it.
    expect(screen.getByRole('status').textContent).toMatch(/You answered: No/u);
    expect(screen.queryByRole('button', { name: 'Yes, it was me' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(answerQuestion).toHaveBeenCalledTimes(1);
  });

  it('shows how the case closed under the answer, as plain text that can neither be followed nor formatted', async () => {
    const resolution = `Go to the service directly. **Do not** use ${PLANTED}`;
    const { container } = view(
      fakeApi(
        {},
        card({
          ...QUESTION,
          state: 'answered',
          answer: { choice: 'No', at: '2026-11-16T02:00:00Z' },
          resolution,
        }),
      ).api,
    );
    const closed = await screen.findByText(/^Closed: /u);
    expect(closed.tagName).toBe('P');
    expect(closed.textContent).toBe(`Closed: ${resolution}`);
    // It follows the answered line, which stays the card's one status.
    expect(closed.previousElementSibling).toBe(screen.getByRole('status'));
    expect(screen.getByRole('status').textContent).toMatch(/^You answered: No/u);
    expect(closed.getAttribute('role')).toBeNull();
    // A link or emphasis written in it stays literal.
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows no closing line on an answered question the case did not close after', async () => {
    const { container } = view(
      fakeApi(
        {},
        card({
          ...QUESTION,
          state: 'answered',
          answer: { choice: 'No', at: '2026-11-16T02:00:00Z' },
        }),
      ).api,
    );
    await waitFor(() => expect(screen.getByText(/You answered: No/u)).toBeTruthy());
    expect(container.textContent).not.toContain('Closed:');
  });

  it('takes a reply in the person’s own words when the question allows one, and never an empty one', async () => {
    const { api, answerQuestion } = fakeApi(
      {},
      card({ ...QUESTION, options: ['Yes'], allowsReply: true }),
    );
    view(api);
    const box = await screen.findByRole('textbox', { name: 'Your reply' });
    expect((screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(box, { target: { value: 'I was on a train' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(answerQuestion).toHaveBeenCalledWith('feed-1', { reply: 'I was on a train' }),
    );
    await waitFor(() => expect(screen.getByText(/You answered: I was on a train/u)).toBeTruthy());
    expect(screen.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
  });

  it('offers only a reply box when the question has no choices', async () => {
    view(fakeApi({}, card({ ...QUESTION, options: [], allowsReply: true })).api);
    const reply = await screen.findByRole('textbox', { name: 'Your reply' });
    const questionCard = reply.closest('li')!;
    expect(within(questionCard).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Send reply',
      'Open thread',
    ]);
  });

  it('says why an answer was refused, on the card', async () => {
    const { api } = fakeApi({
      answerQuestion: async () => {
        throw new ApiError(400, 'That is not one of the choices offered');
      },
    });
    view(api);
    fireEvent.click(await screen.findByRole('button', { name: 'No' }));
    await waitFor(() =>
      expect(screen.getByText('That is not one of the choices offered')).toBeTruthy(),
    );
    expect((screen.getByRole('button', { name: 'No' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a question whose case closed first as no longer waiting, and lets the person dismiss it', async () => {
    const { api } = fakeApi({}, card({ ...QUESTION, state: 'withdrawn' }));
    view(api);
    await waitFor(() =>
      expect(screen.getByText('Your agent closed this case before you answered')).toBeTruthy(),
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Your agent closed this case before you answered',
    );
    expect(screen.queryByRole('button', { name: 'No' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(api.answerFeed).toHaveBeenCalledWith('feed-1', 'dismiss'));
  });
});

describe('the thread of a case', () => {
  it('lists the case’s title, state, notes, question and history in order, and goes back to the feed', async () => {
    view(fakeApi().api);
    fireEvent.click(await screen.findByRole('button', { name: OPEN_THREAD }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'New sign-in to your account' })).toBeTruthy(),
    );
    expect(screen.getByText(/Open · opened/u)).toBeTruthy();
    const history = screen.getByRole('list', { name: 'History' });
    const rows = within(history)
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(3);
    // What the agent noticed and noted came from a mail: a Markdown link in it stays literal text.
    expect(rows[0]).toMatch(
      /^Noticed · .*A mail says a \*\*new sign-in\*\* happened\. \[Verify your sign-in\]\(https:\/\/evil\.example\/login\)$/u,
    );
    expect(rows[1]).toMatch(
      /^Noted · .*The address is the usual one\. \[See the report\]\(https:\/\/evil\.example\/report\)$/u,
    );
    expect(rows[2]).toMatch(/^Asked you · .*Did you sign in just now\?$/u);
    expect(history.querySelector('a')).toBeNull();
    expect(history.querySelector('strong')).toBeNull();
    expect(within(history).queryByRole('link')).toBeNull();
    const waiting = screen.getByRole('region', { name: 'Waiting for you' });
    expect(within(waiting).getByText('Did you sign in just now?')).toBeTruthy();
    expect(within(waiting).getByText('Yes, it was me · No')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to feed' }));
    await waitFor(() => expect(screen.getByRole('button', { name: OPEN_THREAD })).toBeTruthy());
  });

  it('shows the answer and the closing of a settled case, with nothing waiting', async () => {
    const settled: ICaseView = {
      ...THREAD,
      state: 'closed',
      history: [
        ...THREAD.history,
        { at: '2026-11-16T01:05:00Z', kind: 'answered', text: 'Yes, it was me' },
        { at: '2026-11-16T01:06:00Z', kind: 'closed', text: 'The person confirmed it.' },
      ],
    };
    const { question: _answered, ...withoutQuestion } = settled;
    view(fakeApi({ caseThread: async () => withoutQuestion }).api);
    fireEvent.click(await screen.findByRole('button', { name: OPEN_THREAD }));
    await waitFor(() => expect(screen.getByText(/Closed · opened/u)).toBeTruthy());
    const rows = within(screen.getByRole('list', { name: 'History' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
    expect(rows.at(-2)).toMatch(/^You answered · .*Yes, it was me$/u);
    expect(rows.at(-1)).toMatch(/^Closed · .*The person confirmed it\.$/u);
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).toBeNull();
  });

  it('says so when the case cannot be read', async () => {
    view(
      fakeApi({
        caseThread: async () => {
          throw new ApiError(404, 'no such case');
        },
      }).api,
    );
    fireEvent.click(await screen.findByRole('button', { name: OPEN_THREAD }));
    await waitFor(() => expect(screen.getByText('no such case')).toBeTruthy());
  });
});
