// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api.js';
import { BrowseView } from '../views/Browse.js';
import { DEFAULT_PREFERENCES, offer, offersWorld, pageCheck } from './offers-world.js';

import type { IOffersWorld } from './offers-world.js';

afterEach(cleanup);

const TITLE = 'Check a fact on a page I give you';
const WORK_MAIL = {
  kind: 'connector',
  connectorId: 'connector-work-mail',
  connectorTitle: 'Work mail',
  sourceItemId: 'mail:landlord',
  observedAt: '2026-11-25T08:00:00Z',
} as const;

const show = (world: IOffersWorld) => render(<BrowseView api={world.api} newKey={world.newKey} />);
const group = async () => within(await screen.findByRole('region', { name: 'Suggested for you' }));
const card = async (title = TITLE) =>
  within(await (await group()).findByRole('article', { name: title }));

describe('muting from an offer card', () => {
  it('mutes the topic, keeps what was already muted, and the card goes once the agent has taken it', async () => {
    const world = offersWorld({
      offers: [
        offer(),
        offer({
          id: 'offer-2',
          definitionId: 'prepare-my-week',
          definitionTitle: 'Prepare my week',
          reason: 'A different topic.',
        }),
      ],
      definitions: [
        pageCheck(),
        pageCheck({ id: 'prepare-my-week', title: 'Prepare my week', category: 'Planning' }),
      ],
      preferences: { ...DEFAULT_PREFERENCES, mutedTopics: ['finance'] },
    });
    show(world);
    fireEvent.click((await card()).getByRole('button', { name: 'Mute topic Research' }));
    await waitFor(async () =>
      expect((await group()).queryByRole('article', { name: TITLE })).toBeNull(),
    );
    // The topic joins what was muted before, as the agent keeps it: one spelling.
    expect(world.changeOfferPreferences).toHaveBeenCalledTimes(1);
    expect(world.changeOfferPreferences).toHaveBeenCalledWith({
      mutedTopics: ['finance', 'research'],
    });
    // The other topic's card is still there.
    expect(await card('Prepare my week')).toBeTruthy();
  });

  it('mutes the source: the library by its word, a connected service by its id and the name it was given', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'from-library', reason: 'Library reason.' }),
        offer({
          id: 'from-mail',
          reason: 'Mail reason.',
          evidence: WORK_MAIL,
          createdAt: '2026-11-25T10:00:00.000Z',
        }),
      ],
    });
    show(world);
    // Two offers share the task title; each button names the service it acts on, newest card first.
    const buttons = (await group()).getAllByRole('button', { name: /^Mute source/u });
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Mute source Work mail',
      'Mute source your library',
    ]);
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(screen.queryByText('Mail reason.')).toBeNull());
    expect(world.changeOfferPreferences).toHaveBeenLastCalledWith({
      mutedSources: ['connector-work-mail'],
    });
    expect(screen.getByText('Library reason.')).toBeTruthy();

    fireEvent.click((await group()).getByRole('button', { name: 'Mute source your library' }));
    await waitFor(() => expect(screen.queryByText('Library reason.')).toBeNull());
    expect(world.changeOfferPreferences).toHaveBeenLastCalledWith({
      mutedSources: ['connector-work-mail', 'library'],
    });
  });

  it('says what the agent refused, keeps the card and changes nothing on the page', async () => {
    const world = offersWorld({
      offers: [offer()],
      refusePreferences: new ApiError(400, 'mutedTopics holds too many entries'),
    });
    show(world);
    const scope = await card();
    fireEvent.click(scope.getByRole('button', { name: 'Mute topic Research' }));
    await waitFor(() =>
      expect(scope.getByRole('alert').textContent).toBe('mutedTopics holds too many entries'),
    );
    expect((await group()).getByRole('article', { name: TITLE })).toBeTruthy();
    expect(scope.getByRole('button', { name: 'Mute topic Research' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('says the agent could not be reached when the preferences cannot be read, and sends nothing', async () => {
    const world = offersWorld({ offers: [offer()] });
    world.offerPreferences.mockRejectedValueOnce(new Error('offline'));
    show(world);
    const scope = await card();
    fireEvent.click(scope.getByRole('button', { name: 'Mute source your library' }));
    await waitFor(() =>
      expect(scope.getByRole('alert').textContent).toBe(
        'Your agent could not be reached. Try again.',
      ),
    );
    expect(world.changeOfferPreferences).not.toHaveBeenCalled();
    expect((await group()).getByRole('article', { name: TITLE })).toBeTruthy();
  });

  it('does not send a second change for a double press, and the lists are read once', async () => {
    const world = offersWorld({
      offers: [offer()],
      preferences: { ...DEFAULT_PREFERENCES, mutedSources: [] },
    });
    show(world);
    const button = (await card()).getByRole('button', { name: 'Mute source your library' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(async () =>
      expect((await group()).queryByRole('article', { name: TITLE })).toBeNull(),
    );
    expect(world.changeOfferPreferences).toHaveBeenCalledTimes(1);
    expect(world.offerPreferences).toHaveBeenCalledTimes(1);
  });

  it('offers no mute for a topic or source it cannot name, and none on a set-aside card', async () => {
    const world = offersWorld({
      offers: [
        offer({ id: 'no-source', evidence: undefined }),
        offer({ id: 'set-aside', decision: 'dismissed', reason: 'Set aside reason.' }),
      ],
      definitions: [],
    });
    show(world);
    const scope = await card();
    expect(scope.queryByRole('button', { name: /^Mute topic/u })).toBeNull();
    expect(scope.queryByRole('button', { name: /^Mute source/u })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Set aside (1)' }));
    const aside = within(await screen.findByRole('list', { name: 'Set aside' }));
    expect(aside.queryByRole('button', { name: /^Mute/u })).toBeNull();
  });
});
