// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api.js';
import { BrowseView } from '../views/Browse.js';
import { LAUNCH_REFRESH_MS, LAUNCH_WAITING_REFRESH_MS } from '../views/LaunchStatus.js';
import { stepKey } from '../views/TaskReadiness.js';

import type {
  IPersonalApi,
  ITaskDefinitionView,
  ITaskLaunchStatusView,
  TTaskSetupStepView,
} from '../api.js';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DIGEST = 'a'.repeat(64);
const MAIL = 'Catch up on a connected mailbox';

const mailbox = (change: Partial<ITaskDefinitionView> = {}): ITaskDefinitionView => ({
  id: 'catch-up-on-mailbox',
  revision: 1,
  title: MAIL,
  category: 'Mail',
  expectedResult: 'A short summary of the recent mail.',
  inputs: [{ name: 'focus', label: 'Anything in particular', kind: 'text', required: false }],
  capabilities: ['mail.search'],
  effectCeiling: 'read-only',
  completionEvidence: { kind: 'source-readback', description: 'Each message is read back.' },
  readiness: { state: 'needs-setup', steps: [{ type: 'connect', kind: 'mail' }] },
  startable: true,
  ...change,
});

const TWO_ACCOUNTS: TTaskSetupStepView = {
  type: 'choose-account',
  accounts: [
    { id: 'connector-a', title: 'Mail' },
    { id: 'connector-b', title: 'Mail' },
  ],
};

const ACCESS = {
  capability: 'mail.search',
  adapter: 'connector',
  account: 'connector-b',
  tool: 'search_mail',
  effect: 'read-only',
  argumentBoundary: 'search words in the connected mailbox; nothing is sent',
} as const;

const launch = (change: Partial<ITaskLaunchStatusView> = {}): ITaskLaunchStatusView => ({
  id: 'launch-1',
  definitionId: 'catch-up-on-mailbox',
  definitionRevision: 1,
  status: 'setup',
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
  progress: 'setup',
  reason: 'This task needs setting up. It starts once that is done.',
  steps: [TWO_ACCOUNTS],
  evidence: [],
  ...change,
});

const review = launch({
  status: 'review',
  progress: 'review',
  reason: 'Look at the access this task would use, then start it or cancel the request.',
  steps: undefined as never,
  proposed: [ACCESS],
  reviewDigest: DIGEST,
});

type TApi = Pick<
  IPersonalApi,
  'startTask' | 'taskLaunch' | 'chooseLaunchAccount' | 'confirmLaunch' | 'cancelLaunch'
>;

function setup(
  options: {
    definition?: ITaskDefinitionView;
    launches?: readonly ITaskLaunchStatusView[];
    api?: Partial<TApi>;
  } = {},
) {
  const calls = {
    startTask: vi.fn<TApi['startTask']>(async () => ({ launch: launch() })),
    taskLaunch: vi.fn<TApi['taskLaunch']>(async () => options.launches?.[0] ?? launch()),
    chooseLaunchAccount: vi.fn<TApi['chooseLaunchAccount']>(async () => review),
    confirmLaunch: vi.fn<TApi['confirmLaunch']>(async () =>
      launch({
        status: 'launched',
        progress: 'starting',
        goalId: 'goal-1',
        reason: 'Getting going.',
      }),
    ),
    cancelLaunch: vi.fn<TApi['cancelLaunch']>(async () =>
      launch({ status: 'cancelled', progress: 'cancelled', reason: 'Cancelled.' }),
    ),
    ...options.api,
  };
  const api = {
    taskDefinitions: async () => [options.definition ?? mailbox()],
    taskOffers: async () => ({ offers: [], setAside: [], issues: [] }),
    taskLaunches: async () => options.launches ?? [],
    ...calls,
  } as unknown as IPersonalApi;
  render(<BrowseView api={api} newKey={() => 'start-key-1'} />);
  return calls;
}

const card = async () => within(await screen.findByRole('article', { name: MAIL }));
const region = async () => within(await (await card()).findByLabelText('Task status'));
const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('setup steps', () => {
  it('are keyed and labelled by connector id, so two accounts with one title never collide', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setup({
      definition: mailbox({
        readiness: {
          state: 'needs-setup',
          steps: [
            { type: 'reconnect', connectorId: 'connector-a', connectorTitle: 'Mail' },
            { type: 'reconnect', connectorId: 'connector-b', connectorTitle: 'Mail' },
            {
              type: 'allow-tool',
              connectorId: 'connector-a',
              connectorTitle: 'Mail',
              tool: 'search_mail',
              decision: 'read',
            },
            {
              type: 'allow-tool',
              connectorId: 'connector-b',
              connectorTitle: 'Mail',
              tool: 'search_mail',
              decision: 'read',
            },
            TWO_ACCOUNTS,
          ],
        },
      }),
    });
    const steps = within(await (await card()).findByRole('list', { name: 'Setup steps' }));
    expect(steps.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Reconnect Mail (connector-a)',
      'Reconnect Mail (connector-b)',
      'Allow the tool search_mail for Mail (connector-a)',
      'Allow the tool search_mail for Mail (connector-b)',
      'Choose which account to use: Mail (connector-a), Mail (connector-b)',
    ]);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/u);
    errors.mockRestore();
  });

  it('have a key that names the kind or the connector, never the words shown', () => {
    expect(stepKey({ type: 'connect', kind: 'mail' })).toBe('connect:mail');
    expect(stepKey(TWO_ACCOUNTS)).toBe('choose-account:connector-a,connector-b');
    expect(
      stepKey({
        type: 'allow-tool',
        connectorId: 'connector-a',
        connectorTitle: 'x',
        tool: 't',
        decision: 'read',
      }),
    ).toBe('allow-tool:connector-a:t');
    expect(stepKey({ type: 'reconnect', connectorId: 'connector-a', connectorTitle: 'x' })).toBe(
      'reconnect:connector-a',
    );
  });
});

describe('Start on a task that needs setup', () => {
  it('is offered on a startable task and reads “Start when set up”; a task that is not startable or is unavailable has none', async () => {
    setup();
    const waits = await card();
    expect(waits.getByRole('button', { name: 'Start when set up' })).toBeTruthy();
    expect(waits.queryByRole('button', { name: 'Start' })).toBeNull();
    cleanup();
    setup({ definition: mailbox({ startable: false }) });
    expect((await card()).queryByRole('button')).toBeNull();
    cleanup();
    setup({
      definition: mailbox({ readiness: { state: 'unavailable', reason: 'no binding yet' } }),
    });
    expect((await card()).queryByRole('button')).toBeNull();
  });

  it('keeps the request and shows it waiting, with what is left to do, and no goal', async () => {
    const { startTask } = setup();
    fireEvent.click((await card()).getByRole('button', { name: 'Start when set up' }));
    expect(await (await card()).findByLabelText('Task status')).toBeTruthy();
    const shown = await region();
    expect(shown.getByText('Needs setup')).toBeTruthy();
    expect(startTask).toHaveBeenCalledWith('catch-up-on-mailbox', {
      idempotencyKey: 'start-key-1',
      inputs: {},
    });
    expect(shown.queryByRole('button', { name: 'Open goal' })).toBeNull();
    expect(shown.getByRole('button', { name: 'Cancel request' })).toBeTruthy();
  });

  it('offers the accounts by connector id and sends the id of the one chosen', async () => {
    const { chooseLaunchAccount } = setup({ launches: [launch()] });
    const shown = await region();
    const group = within(shown.getByRole('radiogroup', { name: 'Account for this task' }));
    const radios = group.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual(['connector-a', 'connector-b']);
    expect(group.getAllByText(/Mail \(connector-/u).map((label) => label.textContent)).toEqual([
      'Mail (connector-a)',
      'Mail (connector-b)',
    ]);
    // Nothing is sent until one is chosen.
    const use = shown.getByRole('button', { name: 'Use this account' });
    expect((use as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(radios[1]!);
    fireEvent.click(use);
    await later(0);
    expect(chooseLaunchAccount).toHaveBeenCalledTimes(1);
    expect(chooseLaunchAccount).toHaveBeenCalledWith('launch-1', 'connector-b');
    // The answer is the request as it stands: now waiting for a look.
    expect((await region()).getByText('Needs your look')).toBeTruthy();
  });

  it('shows the access in review and sends the digest of what was shown to start it', async () => {
    const { confirmLaunch } = setup({ launches: [review] });
    const shown = await region();
    expect(shown.getByText('Needs your look')).toBeTruthy();
    const list = within(shown.getByRole('list', { name: 'Access to confirm' }));
    expect(list.getByText(ACCESS.argumentBoundary)).toBeTruthy();
    expect(list.getByText(/account connector-b/u)).toBeTruthy();
    expect(list.getByText(/only reads/u)).toBeTruthy();
    fireEvent.click(shown.getByRole('button', { name: 'Start with this access' }));
    await later(0);
    expect(confirmLaunch).toHaveBeenCalledTimes(1);
    expect(confirmLaunch).toHaveBeenCalledWith('launch-1', DIGEST);
    expect((await region()).getByText('Starting')).toBeTruthy();
  });

  it('shows the agent’s refusal when what was shown changed, and reads the request again', async () => {
    const changed = launch({ ...review, reviewDigest: 'b'.repeat(64) });
    let refused = false;
    const confirmLaunch = vi.fn<TApi['confirmLaunch']>(async () => {
      refused = true;
      throw new ApiError(
        409,
        'The access this task would use changed. Look at it again before starting.',
      );
    });
    setup({
      launches: [review],
      api: { confirmLaunch, taskLaunch: vi.fn(async () => (refused ? changed : review)) },
    });
    const shown = await region();
    fireEvent.click(shown.getByRole('button', { name: 'Start with this access' }));
    await later(0);
    const alert = (await region()).getByRole('alert');
    expect(alert.textContent).toBe(
      'The access this task would use changed. Look at it again before starting.',
    );
    // The next press carries the digest of what the page shows now, not the one it showed before.
    fireEvent.click((await region()).getByRole('button', { name: 'Start with this access' }));
    await later(0);
    expect(confirmLaunch.mock.calls.map((call) => call[1])).toEqual([DIGEST, 'b'.repeat(64)]);
  });

  it('cancels a waiting request, in setup or in review', async () => {
    const first = setup({ launches: [launch()] });
    fireEvent.click((await region()).getByRole('button', { name: 'Cancel request' }));
    await later(0);
    expect(first.cancelLaunch).toHaveBeenCalledWith('launch-1');
    expect((await region()).getByText('Cancelled')).toBeTruthy();
    expect((await region()).queryByRole('button', { name: 'Cancel request' })).toBeNull();
    cleanup();
    const second = setup({ launches: [review] });
    fireEvent.click((await region()).getByRole('button', { name: 'Cancel request' }));
    await later(0);
    expect(second.cancelLaunch).toHaveBeenCalledWith('launch-1');
    expect((await region()).getByText('Cancelled')).toBeTruthy();
  });

  it('is read again every ten seconds while it waits, then as it goes, and not once it has ended', async () => {
    const states = [
      launch(),
      launch(),
      review,
      launch({ status: 'launched', progress: 'running', reason: 'Working.' }),
    ];
    let next = 0;
    const { taskLaunch } = setup({
      launches: [launch()],
      api: { taskLaunch: vi.fn(async () => states[Math.min(next++, states.length - 1)]!) },
    });
    await region();
    await later(0);
    expect(taskLaunch).toHaveBeenCalledTimes(1);
    // Not at the pace of a run that is going.
    await later(LAUNCH_REFRESH_MS * 2);
    expect(taskLaunch).toHaveBeenCalledTimes(1);
    await later(LAUNCH_WAITING_REFRESH_MS - LAUNCH_REFRESH_MS * 2);
    expect(taskLaunch).toHaveBeenCalledTimes(2);
    await later(LAUNCH_WAITING_REFRESH_MS);
    expect(taskLaunch).toHaveBeenCalledTimes(3);
    expect((await region()).getByText('Needs your look')).toBeTruthy();
    await later(LAUNCH_WAITING_REFRESH_MS);
    expect(taskLaunch).toHaveBeenCalledTimes(4);
    expect((await region()).getByText('Running')).toBeTruthy();
    // Once running it is read at the pace of a run.
    await later(LAUNCH_REFRESH_MS);
    expect(taskLaunch).toHaveBeenCalledTimes(5);
  });
});
