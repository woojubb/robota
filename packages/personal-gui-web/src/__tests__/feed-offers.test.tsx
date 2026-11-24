// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowseView } from '../views/Browse.js';
import { FeedView } from '../views/Feed.js';
import { OFFERS_IN_FEED, OFFERS_REFRESH_MS } from '../views/OfferFeed.js';
import { offer, offersWorld } from './offers-world.js';

import type { IOffersWorld } from './offers-world.js';
import type { IFeedItemView, IPersonalApi, ITaskOfferView } from '../api.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const TITLE = 'Check a fact on a page I give you';
const HOSTILE = '[click](javascript:alert(1)) **bold** <img src=x onerror=alert(1)>';

const REPORT: IFeedItemView = {
  id: 'item-1',
  at: '2026-11-25T08:00:00Z',
  kind: 'report',
  title: 'Weather',
  body: 'Sunny.',
};

const feedApi = (world: IOffersWorld, items: readonly IFeedItemView[] = []): IPersonalApi =>
  ({ ...world.api, feed: async () => items }) as IPersonalApi;

function showFeed(
  world: IOffersWorld,
  options: {
    items?: readonly IFeedItemView[];
    onOpenOffer?: (id: string) => void;
  } = {},
) {
  const onOpenOffer = options.onOpenOffer ?? vi.fn();
  render(
    <FeedView
      api={feedApi(world, options.items)}
      onOpenGoal={() => undefined}
      onOpenOffer={onOpenOffer}
    />,
  );
  return { onOpenOffer };
}

const entries = async () =>
  within(await screen.findByRole('list', { name: 'Suggested tasks' })).getAllByRole('listitem');

/** The Feed and Browse as the shell wires them: the button on a Feed entry opens that offer's card. */
function Shell({ world }: { readonly world: IOffersWorld }): React.ReactElement {
  const [view, setView] = useState<'feed' | 'browse'>('feed');
  const [focusOffer, setFocusOffer] = useState<string | undefined>(undefined);
  const api = feedApi(world);
  return view === 'feed' ? (
    <FeedView
      api={api}
      onOpenGoal={() => undefined}
      onOpenOffer={(id) => {
        setFocusOffer(id);
        setView('browse');
      }}
    />
  ) : (
    <BrowseView api={api} newKey={world.newKey} {...(focusOffer !== undefined && { focusOffer })} />
  );
}

describe('the suggestions in the Feed', () => {
  it('lists each open offer as a plain entry: the task, why, where it was read, and a button to open it', async () => {
    const world = offersWorld({
      offers: [
        offer({
          id: 'offer-a',
          reason: 'You asked whether shipping is free.',
          createdAt: '2026-11-25T09:00:00.000Z',
        }),
        offer({
          id: 'offer-b',
          definitionId: 'prepare-my-week',
          definitionTitle: 'Prepare my week',
          reason: 'Your week has three meetings that overlap.',
          createdAt: '2026-11-25T10:00:00.000Z',
          evidence: {
            kind: 'connector',
            connectorId: 'connector-work-mail',
            connectorTitle: 'Work mail',
            sourceItemId: 'mail:calendar-invite',
            observedAt: '2026-11-25T08:00:00Z',
          },
        }),
      ],
    });
    showFeed(world);
    const [first, second] = await entries();
    expect(
      within(first!).getByRole('heading', { name: 'Suggested task: Prepare my week' }),
    ).toBeTruthy();
    expect(within(first!).getByText('Your week has three meetings that overlap.')).toBeTruthy();
    expect(
      within(first!).getByText('Suggested by your agent · Connected service: Work mail'),
    ).toBeTruthy();
    expect(within(first!).getByRole('button', { name: 'Open suggestion' })).toBeTruthy();
    expect(within(second!).getByRole('heading', { name: `Suggested task: ${TITLE}` })).toBeTruthy();
    expect(within(second!).getByText('Suggested by your agent · Your library')).toBeTruthy();
  });

  it('only points at an offer: opening one starts nothing and decides nothing', async () => {
    const world = offersWorld({ offers: [offer()] });
    const { onOpenOffer } = showFeed(world);
    const [entry] = await entries();
    // Nothing on the entry can start the task or decide the offer.
    expect(
      within(entry!)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Open suggestion']);
    expect(within(entry!).queryByRole('form')).toBeNull();
    fireEvent.click(within(entry!).getByRole('button', { name: 'Open suggestion' }));
    expect(onOpenOffer).toHaveBeenCalledExactlyOnceWith('offer-1');
    expect(world.startTask).not.toHaveBeenCalled();
    expect(world.decideTaskOffer).not.toHaveBeenCalled();
    expect(world.taskOffer).not.toHaveBeenCalled();
  });

  it('has an entry only for an offer that is open: not one already started, and not one set aside', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'open', reason: 'Open one.' }),
        offer({
          id: 'started',
          reason: 'Started one.',
          decision: 'accepted',
          launchId: 'launch-1',
        }),
        offer({ id: 'dismissed', reason: 'Dismissed one.', decision: 'dismissed' }),
        offer({
          id: 'snoozed',
          reason: 'Snoozed one.',
          decision: 'snoozed',
          snoozedUntil: '2026-11-26T09:00:00.000Z',
        }),
      ],
    });
    showFeed(world);
    const shown = await entries();
    expect(shown).toHaveLength(1);
    expect(within(shown[0]!).getByText('Open one.')).toBeTruthy();
    expect(screen.queryByText('Started one.')).toBeNull();
    expect(screen.queryByText('Dismissed one.')).toBeNull();
    expect(screen.queryByText('Snoozed one.')).toBeNull();
  });

  it('shows at most a few, the newest first', async () => {
    const offers: ITaskOfferView[] = Array.from({ length: OFFERS_IN_FEED + 2 }, (_, index) =>
      offer({
        id: `offer-${index}`,
        reason: `Reason ${index}.`,
        createdAt: `2026-11-25T0${index}:00:00.000Z`,
      }),
    );
    showFeed(offersWorld({ offers }));
    const shown = await entries();
    expect(shown).toHaveLength(OFFERS_IN_FEED);
    expect(shown.map((entry) => within(entry).getByText(/^Reason /u).textContent)).toEqual([
      'Reason 4.',
      'Reason 3.',
      'Reason 2.',
    ]);
  });

  it('shows what a mail or page said as the plain text it is', async () => {
    const world = offersWorld({
      offers: [
        offer({
          reason: HOSTILE,
          evidence: {
            kind: 'connector',
            connectorId: 'connector-a',
            connectorTitle: HOSTILE,
            sourceItemId: HOSTILE,
            observedAt: '2026-11-25T08:00:00Z',
          },
        }),
      ],
    });
    const { container } = render(
      <FeedView api={feedApi(world)} onOpenGoal={() => undefined} onOpenOffer={() => undefined} />,
    );
    const [entry] = await entries();
    expect(within(entry!).getByText(HOSTILE, { selector: 'p' })).toBeTruthy();
    expect(
      within(entry!).getByText(`Suggested by your agent · Connected service: ${HOSTILE}`),
    ).toBeTruthy();
    expect(container.querySelector('a, img, strong, b, em, script')).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('says nothing about suggestions when they cannot be read, and the rest of the Feed is as it was', async () => {
    const world = offersWorld({ offers: [offer()] });
    world.taskOffers.mockImplementation(async () => {
      throw new Error('The agent is not reachable');
    });
    showFeed(world, { items: [REPORT] });
    expect(await screen.findByRole('heading', { name: 'Weather' })).toBeTruthy();
    await waitFor(() => expect(world.taskOffers).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Suggested tasks' })).toBeNull();
    expect(screen.queryByText(/not reachable/u)).toBeNull();
  });

  it('keeps the suggestions it has when a later read fails, and follows them when it works again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = offersWorld({ offers: [offer({ reason: 'First read.' })] });
    let reads = 0;
    world.taskOffers.mockImplementation(async () => {
      reads += 1;
      if (reads === 2) throw new Error('The agent is not reachable');
      return {
        offers: [offer({ reason: reads === 1 ? 'First read.' : 'Third read.' })],
        setAside: [],
        issues: [],
      };
    });
    showFeed(world);
    expect(within((await entries())[0]!).getByText('First read.')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(OFFERS_REFRESH_MS));
    expect(reads).toBe(2);
    expect(within((await entries())[0]!).getByText('First read.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(OFFERS_REFRESH_MS));
    expect(within((await entries())[0]!).getByText('Third read.')).toBeTruthy();
  });

  it('asks nothing of the agent about offers when the Feed has no way to open one', async () => {
    const world = offersWorld({ offers: [offer()] });
    render(<FeedView api={feedApi(world, [REPORT])} onOpenGoal={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'Weather' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Suggested tasks' })).toBeNull();
    expect(world.taskOffers).not.toHaveBeenCalled();
  });

  it('opens the exact card in Browse, opened, without starting anything', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'offer-a', reason: 'The older one.', createdAt: '2026-11-25T09:00:00.000Z' }),
        offer({ id: 'offer-b', reason: 'The newer one.', createdAt: '2026-11-25T10:00:00.000Z' }),
      ],
    });
    render(<Shell world={world} />);
    const [, older] = await entries();
    fireEvent.click(within(older!).getByRole('button', { name: 'Open suggestion' }));
    await screen.findByRole('heading', { name: 'Browse', level: 1 });
    const suggested = within(await screen.findByRole('region', { name: 'Suggested for you' }));
    const cards = await suggested.findAllByRole('article');
    const [newer, sent] = cards;
    // The card for the entry that was pressed is the current one and is open; the other is untouched.
    expect(sent!.getAttribute('aria-current')).toBe('true');
    expect(within(sent!).getByText('The older one.')).toBeTruthy();
    expect(within(sent!).getByRole('button', { name: 'Hide details' })).toBeTruthy();
    expect(newer!.getAttribute('aria-current')).toBeNull();
    expect(within(newer!).getByRole('button', { name: 'Show details' })).toBeTruthy();
    await waitFor(() => expect(world.taskOffer).toHaveBeenCalledTimes(1));
    expect(world.taskOffer).toHaveBeenCalledWith('offer-a');
    // Nothing was started or decided by getting there.
    expect(world.startTask).not.toHaveBeenCalled();
    expect(world.decideTaskOffer).not.toHaveBeenCalled();
    expect(world.records.get('offer-a')!.decision).toBe('open');
  });
});
