// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api.js';
import { SuggestionsSection } from '../views/Suggestions.js';
import { DEFAULT_PREFERENCES, offersWorld } from './offers-world.js';

afterEach(cleanup);

const form = async () => screen.findByRole('form', { name: 'Suggestions' });

describe('the Suggestions settings', () => {
  it('shows what the agent keeps and saves each choice as the agent answers', async () => {
    const world = offersWorld({
      preferences: {
        enabled: true,
        delivery: 'notify',
        topics: ['research'],
        mutedTopics: ['finance', 'travel'],
        mutedSources: ['library'],
      },
    });
    render(<SuggestionsSection api={world.api} />);
    await form();
    expect((screen.getByLabelText('Suggest tasks') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('How you are told') as HTMLSelectElement).value).toBe('notify');
    expect((screen.getByLabelText('Only these topics') as HTMLInputElement).value).toBe('research');
    expect((screen.getByLabelText('Muted topics') as HTMLInputElement).value).toBe(
      'finance, travel',
    );
    expect((screen.getByLabelText('Muted sources') as HTMLInputElement).value).toBe('library');

    fireEvent.click(screen.getByLabelText('Suggest tasks'));
    fireEvent.change(screen.getByLabelText('How you are told'), { target: { value: 'digest' } });
    fireEvent.change(screen.getByLabelText('Only these topics'), {
      target: { value: 'Research, planning , mail,' },
    });
    fireEvent.change(screen.getByLabelText('Muted topics'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Muted sources'), {
      target: { value: 'library, connector-work-mail' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save suggestions' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
    expect(world.changeOfferPreferences).toHaveBeenCalledWith({
      enabled: false,
      delivery: 'digest',
      topics: ['Research', 'planning', 'mail'],
      mutedTopics: [],
      mutedSources: ['library', 'connector-work-mail'],
    });
    expect((screen.getByLabelText('Suggest tasks') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Muted topics') as HTMLInputElement).value).toBe('');
  });

  it('sends only what was changed, so a mute made elsewhere since the form loaded is not undone', async () => {
    const world = offersWorld();
    render(<SuggestionsSection api={world.api} />);
    await form();
    // Another page mutes a topic after this form was read.
    await world.changeOfferPreferences({ mutedTopics: ['research'] });
    world.changeOfferPreferences.mockClear();

    fireEvent.change(screen.getByLabelText('How you are told'), { target: { value: 'notify' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save suggestions' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
    expect(world.changeOfferPreferences).toHaveBeenCalledTimes(1);
    expect(world.changeOfferPreferences).toHaveBeenCalledWith({ delivery: 'notify' });
    // The form now shows what the agent holds, the other page's mute included.
    expect((screen.getByLabelText('Muted topics') as HTMLInputElement).value).toBe('research');

    // Saving again with nothing changed sends nothing and says so.
    world.changeOfferPreferences.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save suggestions' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Nothing changed.'));
    expect(world.changeOfferPreferences).not.toHaveBeenCalled();
  });

  it('offers exactly the three ways of being told', async () => {
    render(<SuggestionsSection api={offersWorld().api} />);
    await form();
    const select = screen.getByLabelText('How you are told') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Feed only',
      'Notify me',
      'Daily digest only',
    ]);
    expect(select.value).toBe(DEFAULT_PREFERENCES.delivery);
  });

  it('says why when the agent refuses a save and leaves what was typed', async () => {
    const world = offersWorld({
      refusePreferences: new ApiError(400, 'delivery must be one of feed, notify, digest'),
    });
    render(<SuggestionsSection api={world.api} />);
    await form();
    fireEvent.change(screen.getByLabelText('Muted sources'), { target: { value: 'not a source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save suggestions' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'delivery must be one of feed, notify, digest',
      ),
    );
    expect((screen.getByLabelText('Muted sources') as HTMLInputElement).value).toBe('not a source');
  });

  it('says so when the settings cannot be read, and shows the agent’s note that unreadable words read as off', async () => {
    const failing = offersWorld();
    failing.offerPreferences.mockRejectedValueOnce(new Error('offline'));
    const first = render(<SuggestionsSection api={failing.api} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('offline'));
    expect(screen.queryByRole('form', { name: 'Suggestions' })).toBeNull();
    first.unmount();

    const damaged = offersWorld();
    damaged.offerPreferences.mockResolvedValueOnce({
      preferences: { ...DEFAULT_PREFERENCES, enabled: false },
      issue: 'Saved suggestion settings could not be read, so suggestions are off.',
    });
    render(<SuggestionsSection api={damaged.api} />);
    await form();
    expect(screen.getByRole('alert').textContent).toBe(
      'Saved suggestion settings could not be read, so suggestions are off.',
    );
    expect((screen.getByLabelText('Suggest tasks') as HTMLInputElement).checked).toBe(false);
  });
});
