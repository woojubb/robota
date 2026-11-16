// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { NotificationsSection } from '../views/Notifications.js';
import { SettingsView } from '../views/Settings.js';

import type { IDeliveryStatusView, IPersonalApi } from '../api.js';

afterEach(cleanup);

const STORED: IDeliveryStatusView = {
  settings: {
    dailyLimit: 3,
    quietHours: { enabled: true, from: '22:00', to: '08:00' },
    digest: { enabled: true, at: '08:00' },
  },
  today: { sent: 1, limit: 3 },
  waitingInDigest: 2,
};

function fakeApi(extra: Partial<IPersonalApi> = {}): IPersonalApi {
  return { delivery: async () => STORED, ...extra } as unknown as IPersonalApi;
}

const field = async (label: string): Promise<HTMLInputElement> =>
  (await screen.findByLabelText(label)) as HTMLInputElement;

describe('the Notifications section', () => {
  it('shows the limits as they are stored, whose they are, and what today has used', async () => {
    render(<NotificationsSection api={fakeApi()} />);
    expect((await field('Daily limit')).value).toBe('3');
    expect((await field('Quiet hours')).checked).toBe(true);
    expect((await field('Quiet hours start')).value).toBe('22:00');
    expect((await field('Quiet hours end')).value).toBe('08:00');
    expect((await field('Daily digest')).checked).toBe(true);
    expect((await field('Digest time')).value).toBe('08:00');
    expect(
      screen.getByText(
        'Your agent suggests how urgent a question is; these limits decide what reaches you.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Today 1 of 3 pushed; 2 questions wait for the digest.', { exact: false }),
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('labels every field, so each one is reached by its name', async () => {
    render(<NotificationsSection api={fakeApi()} />);
    await field('Daily limit');
    const named = [
      screen.getByRole('spinbutton', { name: 'Daily limit' }),
      screen.getByRole('checkbox', { name: 'Quiet hours' }),
      screen.getByRole('checkbox', { name: 'Daily digest' }),
    ];
    expect(named.map((input) => (input as HTMLInputElement).type)).toEqual([
      'number',
      'checkbox',
      'checkbox',
    ]);
    for (const label of ['Quiet hours start', 'Quiet hours end', 'Digest time'])
      expect((await field(label)).type).toBe('time');
    expect(
      screen.getByRole('spinbutton', { name: 'Daily limit' }).getAttribute('aria-describedby'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save notifications' })).toBeTruthy();
  });

  it('saves every limit as the person set it, and shows what the agent kept', async () => {
    const save = vi.fn(async () => ({
      ...STORED,
      settings: {
        dailyLimit: 5,
        quietHours: { enabled: false, from: '23:30', to: '07:00' },
        digest: { enabled: true, at: '09:15' },
      },
      today: { sent: 1, limit: 5 },
    }));
    render(<NotificationsSection api={fakeApi({ saveDelivery: save })} />);
    fireEvent.change(await field('Daily limit'), { target: { value: '5' } });
    fireEvent.click(await field('Quiet hours'));
    fireEvent.change(await field('Quiet hours start'), { target: { value: '23:30' } });
    fireEvent.change(await field('Quiet hours end'), { target: { value: '07:00' } });
    fireEvent.change(await field('Digest time'), { target: { value: '09:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notifications' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
    expect(save).toHaveBeenCalledWith({
      dailyLimit: 5,
      quietHours: { enabled: false, from: '23:30', to: '07:00' },
      digest: { enabled: true, at: '09:15' },
    });
    expect((await field('Daily limit')).value).toBe('5');
    expect((await field('Quiet hours')).checked).toBe(false);
    expect(screen.getByText('Today 1 of 5 pushed', { exact: false })).toBeTruthy();
  });

  it('shows the agent’s refusal in the status line and keeps what the person typed', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(400, 'The daily limit must be a whole number from 0 to 20');
    });
    render(<NotificationsSection api={fakeApi({ saveDelivery: save })} />);
    fireEvent.change(await field('Daily limit'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notifications' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'The daily limit must be a whole number from 0 to 20',
      ),
    );
    expect((await field('Daily limit')).value).toBe('25');
    // The next edit starts a fresh attempt: the old refusal is gone.
    fireEvent.change(await field('Daily limit'), { target: { value: '4' } });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('sends a blank limit as it is, for the agent to refuse, and does not turn it into 0', async () => {
    const save = vi.fn(async () => {
      throw new ApiError(400, 'The daily limit must be a whole number from 0 to 20');
    });
    render(<NotificationsSection api={fakeApi({ saveDelivery: save })} />);
    fireEvent.change(await field('Daily limit'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notifications' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ dailyLimit: Number.NaN }));
  });

  it('says why when the limits cannot be loaded', async () => {
    const failing = fakeApi({
      delivery: async () => {
        throw new ApiError(400, 'The delivery settings file cannot be used');
      },
    });
    render(<NotificationsSection api={failing} />);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'The delivery settings file cannot be used',
      ),
    );
    expect(screen.queryByLabelText('Daily limit')).toBeNull();
  });

  it('is part of the Settings view, beside the model and the browser', async () => {
    const api = fakeApi({
      settings: async () => ({
        providerTypes: ['openai'],
        stateDir: '/home/person/.personal-agent',
        browser: { available: false },
      }),
    });
    render(<SettingsView api={api} />);
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(await screen.findByRole('form', { name: 'Model' })).toBeTruthy();
    expect((await field('Daily limit')).value).toBe('3');
  });
});
