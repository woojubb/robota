// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api.js';
import { BrowseView } from '../views/Browse.js';
import {
  ANSWER,
  LAUNCH_ID,
  PAGE,
  QUESTION,
  STARTING,
  offer,
  offersWorld,
  pageCheck,
} from './offers-world.js';

import type { IOffersWorld } from './offers-world.js';
import type { ITaskDefinitionView, ITaskLaunchStatusView, ITaskStartAnswer } from '../api.js';

afterEach(cleanup);

const HOSTILE = '[click](javascript:alert(1)) **bold** <img src=x onerror=alert(1)>';
const TITLE = 'Check a fact on a page I give you';
const DAY = 24 * 60 * 60 * 1000;

const mailbox = (readiness: ITaskDefinitionView['readiness']): ITaskDefinitionView =>
  pageCheck({
    id: 'catch-up-on-mailbox',
    title: 'Catch up on a connected mailbox',
    category: 'Mail',
    inputs: [{ name: 'focus', label: 'Anything in particular', kind: 'text', required: false }],
    capabilities: ['mail.search'],
    readiness,
  });

function show(world: IOffersWorld, props: Partial<React.ComponentProps<typeof BrowseView>> = {}) {
  return render(<BrowseView api={world.api} newKey={world.newKey} {...props} />);
}

const group = async () => within(await screen.findByRole('region', { name: 'Suggested for you' }));
const card = async (title = TITLE) =>
  within(await (await group()).findByRole('article', { name: title }));
const opened = async (title = TITLE) => {
  const scope = await card(title);
  fireEvent.click(scope.getByRole('button', { name: 'Show details' }));
  return scope;
};

async function fill(
  scope: ReturnType<typeof within>,
  values: Record<string, string>,
): Promise<void> {
  for (const [label, value] of Object.entries(values))
    fireEvent.change(scope.getByLabelText(new RegExp(label, 'u')), { target: { value } });
}

describe('the Suggested for you group', () => {
  it('lists the offers newest first, each with its task, reason, source and how ready the task is', async () => {
    show(
      offersWorld({
        offers: [
          offer({
            id: 'offer-old',
            reason: 'Older reason.',
            createdAt: '2026-11-24T09:00:00.000Z',
          }),
          offer({
            id: 'offer-new',
            definitionId: 'prepare-my-week',
            definitionTitle: 'Prepare my week',
            reason: 'Newer reason.',
            createdAt: '2026-11-25T09:00:00.000Z',
            evidence: {
              kind: 'connector',
              connectorId: 'connector-work-mail',
              connectorTitle: 'Work mail',
              sourceItemId: 'mail:landlord',
              observedAt: '2026-11-25T08:00:00Z',
            },
            readiness: {
              state: 'unavailable',
              reason: 'no verified binding for calendar.read yet',
            },
          }),
        ],
        definitions: [pageCheck()],
      }),
    );
    const suggested = await group();
    const cards = suggested.getAllByRole('article');
    expect(cards.map((entry) => entry.getAttribute('aria-labelledby'))).toEqual([
      'offer-offer-new',
      'offer-offer-old',
    ]);
    const first = within(cards[0]!);
    expect(first.getByRole('heading', { name: 'Prepare my week', level: 3 })).toBeTruthy();
    expect(first.getByText('Newer reason.')).toBeTruthy();
    expect(first.getByText('Suggested by your agent · Connected service: Work mail')).toBeTruthy();
    expect(first.getByText('Unavailable')).toBeTruthy();
    expect(first.getByText('no verified binding for calendar.read yet')).toBeTruthy();
    const second = within(cards[1]!);
    expect(second.getByText('Suggested by your agent · Your library')).toBeTruthy();
    expect(second.getByText('Ready')).toBeTruthy();
    // The same words the task card in the catalog uses for what the task would access.
    expect(
      within(second.getByRole('list', { name: 'Access' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(suggested.queryByText('Nothing is suggested right now.')).toBeNull();
  });

  it('stays apart from the catalog: the same task is a card in each group', async () => {
    show(offersWorld({ offers: [offer()] }));
    await group();
    const tasks = within(await screen.findByRole('region', { name: 'Tasks' }));
    expect(tasks.getAllByRole('article')).toHaveLength(1);
    expect((await group()).getAllByRole('article')).toHaveLength(1);
  });

  it('names a service it has no title for without inventing one', async () => {
    show(
      offersWorld({
        offers: [
          offer({
            evidence: {
              kind: 'connector',
              connectorId: 'connector-x',
              sourceItemId: 'a',
              observedAt: '2026-11-25T08:00:00Z',
            },
          }),
        ],
      }),
    );
    expect(
      (await card()).getByText(
        'Suggested by your agent · Connected service: a service you connected',
      ),
    ).toBeTruthy();
  });

  it('shows what a mail or page said as the plain text it is: no link, markup or formatting, anywhere on the card', async () => {
    const { container } = show(
      offersWorld({
        offers: [
          offer({
            reason: HOSTILE,
            basis: HOSTILE,
            evidence: {
              kind: 'connector',
              connectorId: 'connector-work-mail',
              connectorTitle: HOSTILE,
              sourceItemId: HOSTILE,
              observedAt: '2026-11-25T08:00:00Z',
            },
          }),
        ],
      }),
    );
    const scope = await opened();
    expect(scope.getByText(HOSTILE, { selector: 'p' })).toBeTruthy();
    expect(scope.getByText(`Suggested by your agent · Connected service: ${HOSTILE}`)).toBeTruthy();
    // What it rests on, and the item, are on the opened card.
    expect(scope.getAllByText(HOSTILE)).toHaveLength(3);
    expect(container.querySelector('a, img, strong, b, em, script')).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryAllByRole('img')).toEqual([]);
  });

  it('keeps what an offer rests on, where it was read, when, and when it expires, for opening the card', async () => {
    show(offersWorld({ offers: [offer()] }));
    const scope = await card();
    expect(scope.queryByText('What it rests on:')).toBeNull();
    expect(scope.queryByText('Expires:')).toBeNull();
    fireEvent.click(scope.getByRole('button', { name: 'Show details' }));
    expect(scope.getByText('The returns policy links to the shipping page.')).toBeTruthy();
    expect(scope.getByText('returns-policy')).toBeTruthy();
    expect(scope.getByText('Item:')).toBeTruthy();
    expect(scope.getByText('Observed:')).toBeTruthy();
    expect(scope.getByText('Expires:')).toBeTruthy();
    fireEvent.click(scope.getByRole('button', { name: 'Hide details' }));
    expect(scope.queryByText('What it rests on:')).toBeNull();
  });

  it('offers a Start only for an offer whose task is ready, and says the exact state of the others', async () => {
    show(
      offersWorld({
        definitions: [
          pageCheck(),
          mailbox({ state: 'unavailable', reason: 'no verified binding for mail.search yet' }),
          pageCheck({
            id: 'draft-reply-to-message',
            title: 'Draft a reply',
            inputs: [],
            readiness: { state: 'needs-setup', steps: [{ type: 'connect', kind: 'mail' }] },
          }),
        ],
        offers: [
          offer({ id: 'o-ready', createdAt: '2026-11-25T09:03:00.000Z' }),
          offer({
            id: 'o-unavailable',
            definitionId: 'catch-up-on-mailbox',
            definitionTitle: 'Catch up on a connected mailbox',
            readiness: { state: 'unavailable', reason: 'no verified binding for mail.search yet' },
            createdAt: '2026-11-25T09:02:00.000Z',
          }),
          offer({
            id: 'o-setup',
            definitionId: 'draft-reply-to-message',
            definitionTitle: 'Draft a reply',
            readiness: { state: 'needs-setup', steps: [{ type: 'connect', kind: 'mail' }] },
            createdAt: '2026-11-25T09:01:00.000Z',
          }),
        ],
      }),
    );
    const suggested = await group();
    expect(suggested.queryAllByRole('button', { name: 'Start' })).toEqual([]);
    const ready = await opened();
    const unavailable = await opened('Catch up on a connected mailbox');
    const setup = await opened('Draft a reply');
    expect(ready.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect(unavailable.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(unavailable.queryByRole('form')).toBeNull();
    expect(unavailable.getByText('Unavailable')).toBeTruthy();
    expect(unavailable.getByText('no verified binding for mail.search yet')).toBeTruthy();
    expect(setup.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(setup.queryByRole('form')).toBeNull();
    expect(setup.getByText('Needs setup')).toBeTruthy();
    expect(
      within(setup.getByRole('list', { name: 'Setup steps' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Connect a mail service']);
    expect(suggested.getAllByRole('button', { name: 'Start' })).toHaveLength(1);
  });
});

describe('starting a task from an offer', () => {
  it('begins on the values the offer suggests, which can be changed, and sends what is on the form with the offer', async () => {
    const world = offersWorld({ offers: [offer()] });
    show(world);
    const scope = await opened();
    const page = scope.getByLabelText(/Page address/u) as HTMLInputElement;
    const question = scope.getByLabelText(/What to check/u) as HTMLInputElement;
    expect(page.value).toBe(PAGE);
    expect(question.value).toBe(QUESTION);
    await fill(scope, { 'What to check': '  Is returning free?  ' });
    expect(question.value).toBe('  Is returning free?  ');
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(world.startTask).toHaveBeenCalledTimes(1));
    expect(world.startTask).toHaveBeenCalledWith('check-fact-on-page', {
      idempotencyKey: 'start-key-1',
      inputs: { page: PAGE, question: 'Is returning free?' },
      offerId: 'offer-1',
    });
  });

  it('uses what an offer suggests in place of a default, and a default where it suggests nothing', async () => {
    show(
      offersWorld({
        definitions: [
          pageCheck({
            inputs: [
              { name: 'page', label: 'Page address', kind: 'text', required: true },
              {
                name: 'tone',
                label: 'Tone',
                kind: 'choice',
                required: false,
                choices: ['Friendly', 'Formal'],
                default: 'Formal',
              },
              { name: 'days', label: 'How many days', kind: 'number', required: true, default: 7 },
            ],
          }),
        ],
        offers: [offer({ prefilled: { page: PAGE, tone: 'Friendly' } })],
      }),
    );
    const scope = await opened();
    expect((scope.getByLabelText(/Page address/u) as HTMLInputElement).value).toBe(PAGE);
    expect((scope.getByLabelText(/Tone/u) as HTMLSelectElement).value).toBe('Friendly');
    expect((scope.getByLabelText(/How many days/u) as HTMLInputElement).value).toBe('7');
  });

  it('sends nothing for a value that is missing, and says which', async () => {
    const world = offersWorld({ offers: [offer({ prefilled: { page: PAGE } })] });
    show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect(scope.getByText('What to check is needed.')).toBeTruthy();
    expect(world.startTask).not.toHaveBeenCalled();
  });

  it('is one request for a double click or a double submit, with the fields held while it is in flight', async () => {
    let finish: (answer: ITaskStartAnswer) => void = () => undefined;
    const world = offersWorld({
      offers: [offer()],
      start: () => new Promise((resolve) => (finish = resolve)),
    });
    show(world);
    const scope = await opened();
    const button = scope.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(scope.getByRole('form'));
    expect(button.disabled).toBe(true);
    expect((scope.getByLabelText(/What to check/u) as HTMLInputElement).disabled).toBe(true);
    expect(scope.getByRole('status').textContent).toBe('Starting…');
    expect(world.startTask).toHaveBeenCalledTimes(1);
    finish(ANSWER);
    await scope.findByLabelText('Task status');
    expect(world.startTask).toHaveBeenCalledTimes(1);
    expect(world.keys).toEqual(['start-key-1']);
  });

  it('keeps its key when no answer came back, so pressing Start again is the same request', async () => {
    let attempts = 0;
    const world = offersWorld({
      offers: [offer()],
      start: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return ANSWER;
      },
    });
    show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect((await scope.findByRole('alert')).textContent).toBe(
      'Your agent could not be reached. Press Start to try again.',
    );
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    expect(world.startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
      'start-key-1',
      'start-key-1',
    ]);
    expect(world.startTask.mock.calls.map(([, request]) => request.offerId)).toEqual([
      'offer-1',
      'offer-1',
    ]);
  });

  it('makes a new request after the agent refused one or a value changed', async () => {
    let attempts = 0;
    const world = offersWorld({
      offers: [offer()],
      start: async () => {
        attempts += 1;
        if (attempts <= 2) throw new ApiError(422, 'This task is not ready to start.');
        return ANSWER;
      },
    });
    show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByRole('alert');
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(world.startTask).toHaveBeenCalledTimes(2));
    await scope.findByRole('alert');
    await fill(scope, { 'What to check': 'Is it open?' });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    expect(world.startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
      'start-key-1',
      'start-key-2',
      'start-key-3',
    ]);
  });

  it('shows the agent’s own words when it refuses an offer that was set aside, replaced or has lapsed', async () => {
    const reasons = [
      [409, 'You dismissed this offer. Bring it back to start it.'],
      [409, 'You set this offer aside until later. Bring it back to start it.'],
      [409, 'This offer has expired.'],
      [409, 'A newer offer replaced this one.'],
      [422, 'This task is not ready to start.'],
      [404, 'There is no such offer.'],
    ] as const;
    for (const [status, message] of reasons) {
      const world = offersWorld({
        offers: [offer()],
        start: async () => {
          throw new ApiError(status, message);
        },
      });
      const view = show(world);
      const scope = await opened();
      fireEvent.click(scope.getByRole('button', { name: 'Start' }));
      expect((await scope.findByRole('alert')).textContent).toBe(message);
      view.unmount();
    }
  });

  it('shows a refusal as the plain text it is', async () => {
    const world = offersWorld({
      offers: [offer()],
      start: async () => {
        throw new ApiError(400, HOSTILE);
      },
    });
    const { container } = show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect((await scope.findByRole('alert')).textContent).toBe(HOSTILE);
    expect(container.querySelector('a, img, strong, b, em')).toBeNull();
  });

  it('reads the offers again when the agent says the task is not ready after all, and shows the new state', async () => {
    const world = offersWorld({
      offers: [offer()],
      start: async () => {
        world.records.set(
          'offer-1',
          offer({ readiness: { state: 'unavailable', reason: 'the browser went away' } }),
        );
        throw new ApiError(422, 'This task is not ready to start.');
      },
    });
    show(world);
    const scope = await opened();
    expect(world.taskOffers).toHaveBeenCalledTimes(1);
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByText('the browser went away');
    expect(world.taskOffers).toHaveBeenCalledTimes(2);
    expect(scope.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('shows the launch at once, takes the form away, and shows the offer as started once the agent lists it so', async () => {
    const world = offersWorld({ offers: [offer()] });
    show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect((await scope.findByLabelText('Task status')).textContent).toContain('Starting');
    // A started offer cannot be started again: there is nothing left to press Start on.
    expect(scope.queryByRole('form')).toBeNull();
    expect(scope.queryByRole('button', { name: 'Start' })).toBeNull();
    await waitFor(() => expect(world.taskOffers).toHaveBeenCalledTimes(2));
    expect(scope.getByText('Started')).toBeTruthy();
    expect(scope.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(scope.queryByRole('button', { name: 'Snooze 1 day' })).toBeNull();
    expect(world.startTask).toHaveBeenCalledTimes(1);
  });

  it('shows the launch a start answered with, and no second Start, even when the offer is not listed as started', async () => {
    // A task started by hand with the same values is the launch a second start gets back; the offer
    // is not accepted by it, and the card still shows what became of the request.
    const world = offersWorld({ offers: [offer()], start: async () => ANSWER });
    show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    await waitFor(() => expect(world.taskOffers).toHaveBeenCalledTimes(2));
    expect(scope.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(scope.getByLabelText('Task status')).toBeTruthy();
  });

  it('opens the goal a started offer made', async () => {
    const opens: string[] = [];
    const world = offersWorld({ offers: [offer()] });
    show(world, { onOpenGoal: (goalId) => opens.push(goalId) });
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    fireEvent.click(await scope.findByRole('button', { name: 'Open goal' }));
    expect(opens).toEqual(['goal-1']);
  });
});

describe('an offer that was changed somewhere else', () => {
  /**
   * Start is refused with `status` and `message`, and `change` is what happened to the offer in the
   * meantime. The next read of the lists is held, so the reason can be seen before the card follows.
   */
  async function refused(
    status: number,
    message: string,
    change: (world: IOffersWorld) => void,
  ): Promise<{ world: IOffersWorld; scope: ReturnType<typeof within>; release: () => void }> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const world: IOffersWorld = offersWorld({
      offers: [offer()],
      start: async () => {
        change(world);
        throw new ApiError(status, message);
      },
    });
    const read = world.taskOffers.getMockImplementation()!;
    show(world);
    const scope = await opened();
    world.taskOffers.mockImplementationOnce(async () => {
      await gate;
      return read();
    });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect((await scope.findByRole('alert')).textContent).toBe(message);
    expect(world.taskOffers).toHaveBeenCalledTimes(2);
    return { world, scope, release };
  }

  it('reads the lists again when Start is refused because the offer was dismissed, and the card moves to Set aside', async () => {
    const message = 'You dismissed this offer. Bring it back to start it.';
    const { scope, release } = await refused(409, message, (world) =>
      world.records.set('offer-1', offer({ decision: 'dismissed' })),
    );
    // Until the lists are read again the card still says what was refused, and has not changed.
    expect(scope.getByRole('button', { name: 'Start' })).toBeTruthy();
    release();
    const suggested = await group();
    await waitFor(() => expect(suggested.queryAllByRole('article')).toEqual([]));
    fireEvent.click(suggested.getByRole('button', { name: 'Set aside (1)' }));
    const aside = within(suggested.getByRole('list', { name: 'Set aside' }));
    expect(aside.getByText('Dismissed')).toBeTruthy();
    expect(aside.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  it('follows an offer that was snoozed elsewhere into Set aside, with the time it comes back', async () => {
    const { release } = await refused(
      409,
      'You set this offer aside until later. Bring it back to start it.',
      (world) =>
        world.records.set(
          'offer-1',
          offer({ decision: 'snoozed', snoozedUntil: '2099-11-26T09:00:00.000Z' }),
        ),
    );
    release();
    const suggested = await group();
    await waitFor(() => expect(suggested.queryAllByRole('article')).toEqual([]));
    fireEvent.click(suggested.getByRole('button', { name: 'Set aside (1)' }));
    expect(
      within(suggested.getByRole('list', { name: 'Set aside' })).getByText(/^Snoozed until /u),
    ).toBeTruthy();
  });

  it('shows the launch an offer already made elsewhere, and takes the form and the decisions away', async () => {
    const { scope, release } = await refused(409, 'This offer was already started.', (world) =>
      world.records.set('offer-1', offer({ decision: 'accepted', launchId: LAUNCH_ID })),
    );
    release();
    expect((await scope.findByLabelText('Task status')).textContent).toContain('Starting');
    await waitFor(() => expect(scope.queryByRole('form')).toBeNull());
    expect(scope.getByText('Started')).toBeTruthy();
    expect(scope.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(scope.queryByRole('button', { name: 'Snooze 1 day' })).toBeNull();
  });

  it('drops the card when Start is refused because there is no such offer any more', async () => {
    const { world, release } = await refused(404, 'There is no such offer.', (changed) =>
      changed.records.delete('offer-1'),
    );
    release();
    const suggested = await group();
    await waitFor(() => expect(suggested.queryAllByRole('article')).toEqual([]));
    expect(suggested.getByText('Nothing is suggested right now.')).toBeTruthy();
    expect(suggested.queryByRole('button', { name: /Set aside/u })).toBeNull();
    expect(world.taskOffers).toHaveBeenCalledTimes(2);
  });

  it('keeps the card, the reason and what was typed when the refusal is about a value and the offer stands', async () => {
    const message = 'Page address: the page address must start with https://';
    const { world, scope, release } = await refused(400, message, () => undefined);
    release();
    await waitFor(() => expect(world.taskOffers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(scope.getByRole('alert').textContent).toBe(message));
    expect(scope.getByRole('button', { name: 'Start' })).toBeTruthy();
    expect((scope.getByLabelText(/What to check/u) as HTMLInputElement).value).toBe(QUESTION);
  });
});

describe('closing an offer’s card while it is being started', () => {
  it('keeps one request, its key and the typed values when the card is closed and opened during it', async () => {
    let finish: (answer: ITaskStartAnswer) => void = () => undefined;
    const world = offersWorld({
      offers: [offer()],
      start: () => new Promise((resolve) => (finish = resolve)),
    });
    show(world);
    const scope = await opened();
    await fill(scope, { 'What to check': 'Is returning free?' });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect(world.startTask).toHaveBeenCalledTimes(1);

    fireEvent.click(scope.getByRole('button', { name: 'Hide details' }));
    // Out of sight, not gone: nothing of the form can be reached while the card is closed.
    expect(scope.queryByRole('form')).toBeNull();
    expect(scope.queryByRole('button', { name: 'Start' })).toBeNull();
    fireEvent.click(scope.getByRole('button', { name: 'Show details' }));

    // It is the same form: the request is still in flight, the fields are held, the typing is there.
    const start = scope.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const question = scope.getByLabelText(/What to check/u) as HTMLInputElement;
    expect(question.disabled).toBe(true);
    expect(question.value).toBe('Is returning free?');
    expect(scope.getByRole('status').textContent).toBe('Starting…');
    fireEvent.click(start);
    fireEvent.submit(scope.getByRole('form'));
    expect(world.startTask).toHaveBeenCalledTimes(1);

    finish(ANSWER);
    await scope.findByLabelText('Task status');
    expect(world.startTask).toHaveBeenCalledTimes(1);
    expect(world.keys).toEqual(['start-key-1']);
    expect(world.startTask.mock.calls[0]![1]).toEqual({
      idempotencyKey: 'start-key-1',
      inputs: { page: PAGE, question: 'Is returning free?' },
      offerId: 'offer-1',
    });
  });

  it('keeps what was typed when the card is closed and opened again, and sends exactly that', async () => {
    const world = offersWorld({ offers: [offer()] });
    show(world);
    const scope = await opened();
    await fill(scope, {
      'Page address': 'https://example.com/other',
      'What to check': 'Is it free?',
    });
    fireEvent.click(scope.getByRole('button', { name: 'Hide details' }));
    fireEvent.click(scope.getByRole('button', { name: 'Show details' }));
    expect((scope.getByLabelText(/Page address/u) as HTMLInputElement).value).toBe(
      'https://example.com/other',
    );
    expect((scope.getByLabelText(/What to check/u) as HTMLInputElement).value).toBe('Is it free?');
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    expect(world.startTask.mock.calls[0]![1].inputs).toEqual({
      page: 'https://example.com/other',
      question: 'Is it free?',
    });
  });

  it('keeps the key of a request that got no answer when the card is closed and opened before trying again', async () => {
    let attempts = 0;
    const world = offersWorld({
      offers: [offer()],
      start: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return ANSWER;
      },
    });
    show(world);
    const scope = await opened();
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByRole('alert');
    fireEvent.click(scope.getByRole('button', { name: 'Hide details' }));
    fireEvent.click(scope.getByRole('button', { name: 'Show details' }));
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    await scope.findByLabelText('Task status');
    expect(world.startTask.mock.calls.map(([, request]) => request.idempotencyKey)).toEqual([
      'start-key-1',
      'start-key-1',
    ]);
    expect(world.keys).toEqual(['start-key-1']);
  });

  it('has no form to reach while the card is closed, and one once it is opened', async () => {
    show(offersWorld({ offers: [offer()] }));
    const scope = await card();
    expect(scope.queryByRole('form')).toBeNull();
    expect(scope.queryByRole('textbox', { name: /What to check/u })).toBeNull();
    fireEvent.click(scope.getByRole('button', { name: 'Show details' }));
    expect(scope.getByRole('form')).toBeTruthy();
    expect(scope.getByRole('textbox', { name: /What to check/u })).toBeTruthy();
  });
});

describe('an offer that was started', () => {
  const verified: ITaskLaunchStatusView = {
    ...STARTING,
    progress: 'verified',
    reason: 'Your agent’s own browser opened and read the page you named during this run.',
    report: 'Yes. The page says: free shipping.',
    decidedAt: '2026-11-25T10:00:09.000Z',
  };

  it('stays in the group with where its launch stands, and has no Start, Dismiss or Snooze', async () => {
    show(
      offersWorld({
        offers: [offer({ decision: 'accepted', launchId: LAUNCH_ID })],
        launches: [verified],
      }),
    );
    const scope = await card();
    expect(
      within(await scope.findByLabelText('Task status')).getByText('Completed (verified)'),
    ).toBeTruthy();
    expect(scope.getByText('Started')).toBeTruthy();
    expect(scope.queryByText('Ready')).toBeNull();
    expect(scope.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(scope.queryByRole('button', { name: /Snooze/u })).toBeNull();
    fireEvent.click(scope.getByRole('button', { name: 'Show details' }));
    expect(scope.queryByRole('form')).toBeNull();
    expect(scope.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('reads the launch from the agent when the list has no word on it yet', async () => {
    const world = offersWorld({ offers: [offer({ decision: 'accepted', launchId: LAUNCH_ID })] });
    show(world);
    const scope = await card();
    expect((await scope.findByLabelText('Task status')).textContent).toContain('Starting');
  });
});

describe('putting an offer off', () => {
  it('dismisses it, moves it to a closed Set aside list, and brings it back with Reopen', async () => {
    const world = offersWorld({ offers: [offer()] });
    show(world);
    const scope = await card();
    fireEvent.click(scope.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(world.decideTaskOffer).toHaveBeenCalledExactlyOnceWith('offer-1', {
        decision: 'dismissed',
      }),
    );
    const suggested = await group();
    await waitFor(() => expect(suggested.queryAllByRole('article')).toEqual([]));
    expect(suggested.getByText('Nothing is suggested right now.')).toBeTruthy();
    // Set aside is closed until asked for, and says how many it holds.
    expect(suggested.queryByRole('list', { name: 'Set aside' })).toBeNull();
    const toggle = suggested.getByRole('button', { name: 'Set aside (1)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const aside = within(suggested.getByRole('list', { name: 'Set aside' }));
    expect(aside.getByText(TITLE)).toBeTruthy();
    expect(aside.getByText('Dismissed')).toBeTruthy();
    expect(aside.getByText('You asked whether shipping is free.')).toBeTruthy();
    expect(aside.queryByRole('button', { name: 'Start' })).toBeNull();

    fireEvent.click(aside.getByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(world.decideTaskOffer).toHaveBeenLastCalledWith('offer-1', { decision: 'open' }),
    );
    await waitFor(() => expect(suggested.getAllByRole('article')).toHaveLength(1));
    expect(suggested.queryByRole('button', { name: /Set aside/u })).toBeNull();
  });

  it.each([
    ['Snooze 1 day', DAY],
    ['Snooze 1 week', 7 * DAY],
  ])('sets an offer aside for later with “%s”, until that time from now', async (label, wait) => {
    const world = offersWorld({ offers: [offer()] });
    show(world);
    const scope = await card();
    const before = Date.now();
    fireEvent.click(scope.getByRole('button', { name: label }));
    await waitFor(() => expect(world.decideTaskOffer).toHaveBeenCalledTimes(1));
    const after = Date.now();
    const [id, request] = world.decideTaskOffer.mock.calls[0]!;
    expect(id).toBe('offer-1');
    if (request.decision !== 'snoozed') throw new Error(`asked for ${request.decision}`);
    const until = Date.parse(request.snoozedUntil);
    expect(until).toBeGreaterThanOrEqual(before + wait);
    expect(until).toBeLessThanOrEqual(after + wait);
    const suggested = await group();
    await waitFor(() => expect(suggested.queryAllByRole('article')).toEqual([]));
    fireEvent.click(suggested.getByRole('button', { name: 'Set aside (1)' }));
    expect(
      within(suggested.getByRole('list', { name: 'Set aside' })).getByText(/^Snoozed until /u),
    ).toBeTruthy();
  });

  it('puts one off at a time, and leaves the other offers where they are', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'offer-a', reason: 'First.', createdAt: '2026-11-25T09:00:00.000Z' }),
        offer({ id: 'offer-b', reason: 'Second.', createdAt: '2026-11-25T10:00:00.000Z' }),
      ],
    });
    show(world);
    const suggested = await group();
    const [newer] = await suggested.findAllByRole('article');
    fireEvent.click(within(newer!).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(suggested.getAllByRole('article')).toHaveLength(1));
    expect(suggested.getByText('First.')).toBeTruthy();
    expect(world.decideTaskOffer).toHaveBeenCalledExactlyOnceWith('offer-b', {
      decision: 'dismissed',
    });
  });

  it('sends one decision for a double click, and shows the agent’s refusal beside the offer', async () => {
    const world = offersWorld({ offers: [offer()] });
    world.decideTaskOffer.mockImplementation(async () => {
      throw new ApiError(409, 'This offer was already started.');
    });
    show(world);
    const scope = await card();
    const dismiss = scope.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);
    expect((await scope.findByRole('alert')).textContent).toBe('This offer was already started.');
    expect(world.decideTaskOffer).toHaveBeenCalledTimes(1);
    // The offer stays where it was, and can be tried again.
    expect(scope.getByText('You asked whether shipping is free.')).toBeTruthy();
    expect((scope.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('says so when the agent cannot be reached, and when it cannot show the lists after a decision', async () => {
    const world = offersWorld({
      offers: [offer()],
      failRead: (read) => (read === 2 ? new Error('The agent is not reachable') : undefined),
    });
    show(world);
    const scope = await card();
    fireEvent.click(scope.getByRole('button', { name: 'Dismiss' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The agent is not reachable');
    // The decision was made; the page could only not show it yet, and says that.
    expect(world.decideTaskOffer).toHaveBeenCalledTimes(1);
  });

  it('says the agent could not be reached when a decision gets no answer', async () => {
    const world = offersWorld({ offers: [offer()] });
    world.decideTaskOffer.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    show(world);
    const scope = await card();
    fireEvent.click(scope.getByRole('button', { name: 'Snooze 1 day' }));
    expect((await scope.findByRole('alert')).textContent).toBe(
      'Your agent could not be reached. Try again.',
    );
  });

  it('shows what is set aside as plain text, and Reopen is the only thing it offers', async () => {
    const { container } = show(
      offersWorld({
        offers: [
          offer({
            decision: 'snoozed',
            snoozedUntil: '2026-11-26T09:00:00.000Z',
            reason: HOSTILE,
            evidence: {
              kind: 'connector',
              connectorId: 'connector-a',
              connectorTitle: HOSTILE,
              sourceItemId: 'x',
              observedAt: '2026-11-25T08:00:00Z',
            },
          }),
        ],
      }),
    );
    const suggested = await group();
    fireEvent.click(await suggested.findByRole('button', { name: 'Set aside (1)' }));
    const aside = within(suggested.getByRole('list', { name: 'Set aside' }));
    expect(aside.getByText(HOSTILE, { selector: 'p' })).toBeTruthy();
    expect(aside.getAllByRole('button').map((button) => button.textContent)).toEqual(['Reopen']);
    expect(container.querySelector('a, img, strong, b, em')).toBeNull();
  });
});

describe('opening an offer’s card', () => {
  it('tells the agent once, when the card is opened, and not when the list is shown', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'offer-a', createdAt: '2026-11-25T09:00:00.000Z' }),
        offer({ id: 'offer-b', createdAt: '2026-11-25T10:00:00.000Z' }),
      ],
    });
    show(world);
    const suggested = await group();
    const [newer, older] = await suggested.findAllByRole('article');
    expect(world.taskOffer).not.toHaveBeenCalled();
    fireEvent.click(within(newer!).getByRole('button', { name: 'Show details' }));
    await waitFor(() => expect(world.taskOffer).toHaveBeenCalledTimes(1));
    expect(world.taskOffer).toHaveBeenCalledWith('offer-b');
    // Closing and opening it again, and the list being read again, ask for nothing more.
    fireEvent.click(within(newer!).getByRole('button', { name: 'Hide details' }));
    fireEvent.click(within(newer!).getByRole('button', { name: 'Show details' }));
    fireEvent.click(within(older!).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(world.taskOffers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(suggested.getAllByRole('article')).toHaveLength(1));
    expect(world.taskOffer).toHaveBeenCalledTimes(1);
  });

  it('tells the agent about each card that is opened, and only those', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'offer-a', createdAt: '2026-11-25T09:00:00.000Z' }),
        offer({ id: 'offer-b', createdAt: '2026-11-25T10:00:00.000Z' }),
        offer({ id: 'offer-c', createdAt: '2026-11-25T11:00:00.000Z' }),
      ],
    });
    show(world);
    const [, second, third] = await (await group()).findAllByRole('article');
    fireEvent.click(within(third!).getByRole('button', { name: 'Show details' }));
    fireEvent.click(within(second!).getByRole('button', { name: 'Show details' }));
    await waitFor(() => expect(world.taskOffer).toHaveBeenCalledTimes(2));
    expect(world.taskOffer.mock.calls.map(([id]) => id).sort()).toEqual(['offer-a', 'offer-b']);
  });

  it('shows the card whatever the agent answers to being told', async () => {
    const world = offersWorld({ offers: [offer()] });
    world.taskOffer.mockImplementation(async () => {
      throw new ApiError(404, 'There is no such offer.');
    });
    show(world);
    const scope = await opened();
    await waitFor(() => expect(world.taskOffer).toHaveBeenCalledTimes(1));
    expect(scope.getByText('The returns policy links to the shipping page.')).toBeTruthy();
    expect(scope.queryByRole('alert')).toBeNull();
  });

  it('opens the card the person was sent to, once, and marks it as the current one', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'offer-a', createdAt: '2026-11-25T09:00:00.000Z' }),
        offer({ id: 'offer-b', reason: 'The one sent to.', createdAt: '2026-11-25T10:00:00.000Z' }),
      ],
    });
    show(world, { focusOffer: 'offer-a' });
    const suggested = await group();
    const [newer, older] = await suggested.findAllByRole('article');
    expect(older!.getAttribute('aria-current')).toBe('true');
    expect(newer!.getAttribute('aria-current')).toBeNull();
    expect(within(older!).getByRole('button', { name: 'Hide details' })).toBeTruthy();
    expect(within(newer!).getByRole('button', { name: 'Show details' })).toBeTruthy();
    await waitFor(() => expect(world.taskOffer).toHaveBeenCalledTimes(1));
    expect(world.taskOffer).toHaveBeenCalledWith('offer-a');
    expect(within(older!).getByRole('form')).toBeTruthy();
  });

  it('opens the Set aside list when the card the person was sent to is in it, and says when it is gone', async () => {
    const world = offersWorld({ offers: [offer({ decision: 'dismissed' })] });
    show(world, { focusOffer: 'offer-1' });
    const suggested = await group();
    expect(await suggested.findByRole('list', { name: 'Set aside' })).toBeTruthy();
    expect(suggested.queryByRole('status')).toBeNull();
    cleanup();
    show(offersWorld({ offers: [] }), { focusOffer: 'offer-gone' });
    expect((await (await group()).findByRole('status')).textContent).toBe(
      'That suggestion is not available any more.',
    );
  });
});

describe('what the page does with a list that cannot be read', () => {
  it('shows what the agent could not read from what it saved, beside the offers it could', async () => {
    const world = offersWorld({ offers: [offer()] });
    world.taskOffers.mockImplementation(async () => ({
      offers: [offer()],
      setAside: [],
      issues: ['1 saved offer could not be read and is not shown.'],
    }));
    show(world);
    expect(
      await screen.findByText('1 saved offer could not be read and is not shown.'),
    ).toBeTruthy();
    expect((await group()).getAllByRole('article')).toHaveLength(1);
  });
});
