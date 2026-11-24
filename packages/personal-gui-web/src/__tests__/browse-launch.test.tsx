// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowseView } from '../views/Browse.js';
import { FeedView } from '../views/Feed.js';
import { LAUNCH_REFRESH_MS } from '../views/LaunchStatus.js';

import type {
  IFeedItemView,
  IPersonalApi,
  ITaskDefinitionView,
  ITaskEvidenceView,
  ITaskLaunchStatusView,
  ITaskStartAnswer,
} from '../api.js';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PAGE = 'https://example.com/pricing';

const pageCheck: ITaskDefinitionView = {
  id: 'check-fact-on-page',
  revision: 1,
  title: 'Check a fact on a page I give you',
  category: 'Research',
  expectedResult: 'A yes, no or not-stated answer with the supporting passage.',
  inputs: [
    { name: 'page', label: 'Page address', kind: 'text', required: true },
    { name: 'question', label: 'What to check', kind: 'text', required: true },
  ],
  capabilities: ['web.read'],
  effectCeiling: 'read-only',
  completionEvidence: { kind: 'source-readback', description: 'The passage is read back.' },
  readiness: { state: 'ready', accesses: ['https pages the person names'] },
};

const read: ITaskEvidenceView = {
  kind: 'page-read',
  tool: 'open',
  requested: PAGE,
  address: PAGE,
  chars: 84,
  digest: 'a'.repeat(64),
  excerpt: 'Free shipping on orders over 20 dollars',
  at: '2026-11-24T10:00:05.000Z',
};

const launch = (change: Partial<ITaskLaunchStatusView> = {}): ITaskLaunchStatusView => ({
  id: 'launch-1',
  definitionId: 'check-fact-on-page',
  definitionRevision: 1,
  status: 'launched',
  goalId: 'goal-1',
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
  progress: 'verified',
  reason: 'Your agent’s own browser opened and read the page you named during this run.',
  report: 'Yes. The page says: free shipping.',
  evidence: [read],
  decidedAt: '2026-11-24T10:00:09.000Z',
  ...change,
});

const ANSWER: ITaskStartAnswer = { launch: launch(), goalId: 'goal-1' };

function setup(
  options: {
    launches?: readonly ITaskLaunchStatusView[];
    taskLaunch?: (id: string) => Promise<ITaskLaunchStatusView>;
    onOpenGoal?: (goalId: string) => void;
    onOpenFeed?: (launchId: string) => void;
    focusLaunch?: string;
  } = {},
) {
  const taskLaunch = vi.fn(options.taskLaunch ?? (async () => launch()));
  const api = {
    taskDefinitions: async () => [pageCheck],
    taskOffers: async () => ({ offers: [], issues: [] }),
    taskLaunches: async () => options.launches ?? [],
    taskLaunch,
    startTask: vi.fn(async () => ANSWER),
  } as unknown as IPersonalApi;
  render(
    <BrowseView
      api={api}
      {...(options.onOpenGoal !== undefined && { onOpenGoal: options.onOpenGoal })}
      {...(options.onOpenFeed !== undefined && { onOpenFeed: options.onOpenFeed })}
      {...(options.focusLaunch !== undefined && { focusLaunch: options.focusLaunch })}
    />,
  );
  return { api, taskLaunch };
}

const card = async () =>
  within(await screen.findByRole('article', { name: 'Check a fact on a page I give you' }));
const region = async () => (await card()).findByLabelText('Task status');
const status = async () => within(await region());

/** Move the page's clock on, as time passes while it is open. */
const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('where a started task stands on its card', () => {
  it.each([
    ['starting', 'Starting'],
    ['running', 'Running'],
    ['waiting', 'Waiting for you'],
    ['verified', 'Completed (verified)'],
    ['unverified', 'Unverified'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
  ] as const)('shows %s as “%s”, with the agent’s reason', async (progress, label) => {
    setup({
      launches: [launch({ progress, reason: `Because ${progress}.` })],
      taskLaunch: async () => launch({ progress, reason: `Because ${progress}.` }),
    });
    const shown = await status();
    expect(shown.getByText(label)).toBeTruthy();
    expect(shown.getByText(`Because ${progress}.`)).toBeTruthy();
  });

  it('says completed only for a result the agent checked, and never for a run that ended without proof', async () => {
    setup({
      launches: [
        launch({
          progress: 'unverified',
          reason: 'The run finished, but nothing it read matches the page you named.',
          evidence: [],
        }),
      ],
    });
    const shown = await status();
    expect(shown.getByText('Unverified')).toBeTruthy();
    expect(shown.getByText('Report (not checked)')).toBeTruthy();
    expect(shown.queryByText('Report')).toBeNull();
    expect(shown.getByText('Nothing your agent read was recorded for this run.')).toBeTruthy();
    // With nothing to show, there is no list to call evidence.
    expect(shown.queryByRole('list')).toBeNull();
    // No success wording anywhere on an unverified result.
    expect((await region()).textContent).not.toMatch(/completed|success|\bverified\b|\bdone\b/iu);
    cleanup();

    setup({ launches: [launch()] });
    const checked = await status();
    expect(checked.getByText('Completed (verified)')).toBeTruthy();
    expect(checked.getByText('Report')).toBeTruthy();
    expect(checked.queryByText('Report (not checked)')).toBeNull();
    // The two differ in more than a word: the chip is styled apart.
    const chip = (name: string) => checked.getByText(name).className;
    expect(chip('Completed (verified)')).toContain('text-success');
    expect(chip('Completed (verified)')).not.toContain('text-warning');
  });

  it('calls what the browser returned evidence only when the agent checked the result, and what was read otherwise', async () => {
    for (const progress of ['unverified', 'failed', 'cancelled'] as const) {
      setup({ launches: [launch({ progress })] });
      const shown = await status();
      expect(shown.getByRole('list', { name: 'What was read' }).textContent).toContain(PAGE);
      expect(shown.getByText('What was read')).toBeTruthy();
      expect(shown.queryByText('Evidence')).toBeNull();
      expect(shown.queryByRole('list', { name: 'Evidence' })).toBeNull();
      cleanup();
    }
    setup({ launches: [launch()] });
    const checked = await status();
    expect(checked.getByRole('list', { name: 'Evidence' }).textContent).toContain(PAGE);
    expect(checked.queryByText('What was read')).toBeNull();
  });

  it('shows the report, and the evidence as what was opened, where, when and how much text, with the excerpt', async () => {
    setup({ launches: [launch()] });
    const shown = await status();
    expect(shown.getByText('Yes. The page says: free shipping.')).toBeTruthy();
    const list = shown.getByRole('list', { name: 'Evidence' });
    const item = within(list).getByRole('listitem');
    expect(item.textContent).toContain(`Opened ${PAGE}`);
    expect(item.textContent).toContain('84 characters');
    expect(item.textContent).toContain('Free shipping on orders over 20 dollars');
    expect(item.textContent).toContain(
      new Date(read.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    );
    // A page the run was sent on from is shown with where it was asked to go.
    cleanup();
    setup({
      launches: [
        launch({
          evidence: [{ ...read, requested: 'https://example.com/go', address: PAGE, tool: 'open' }],
        }),
      ],
    });
    expect((await status()).getByRole('listitem').textContent).toContain(
      'asked for https://example.com/go',
    );
  });

  it('shows what the agent says as the plain text it is, whatever it carries', async () => {
    const hostile =
      '<img src=x onerror=alert(1)> **bold** [link](https://evil.example) <script>x()</script>';
    setup({
      launches: [
        launch({
          reason: `Reason ${hostile}`,
          report: `Report ${hostile}\n\nsecond line`,
          evidence: [{ ...read, excerpt: `Excerpt ${hostile}`, address: `${PAGE}?q=${hostile}` }],
        }),
      ],
    });
    const shown = await region();
    expect(shown.textContent).toContain(`Report ${hostile}`);
    expect(shown.textContent).toContain(`Excerpt ${hostile}`);
    expect(shown.textContent).toContain(`Reason ${hostile}`);
    expect(shown.querySelector('a, img, script, strong, b, em, i, code, pre')).toBeNull();
    expect(shown.querySelectorAll('p').length).toBeGreaterThan(0);
  });

  it('opens the goal and the Feed report when the person asks, once the run has ended', async () => {
    const onOpenGoal = vi.fn();
    const onOpenFeed = vi.fn();
    setup({ launches: [launch()], onOpenGoal, onOpenFeed });
    const shown = await status();
    fireEvent.click(shown.getByRole('button', { name: 'Open goal' }));
    fireEvent.click(shown.getByRole('button', { name: 'Open in Feed' }));
    expect(onOpenGoal).toHaveBeenCalledExactlyOnceWith('goal-1');
    expect(onOpenFeed).toHaveBeenCalledExactlyOnceWith('launch-1');
  });

  it('offers the goal but no Feed report while the run is going, and neither for a request that made no goal', async () => {
    const { goalId: _goal, ...noGoal } = launch({
      status: 'failed',
      progress: 'failed',
      reason: 'Your agent could not set this task up. Try starting it again.',
      evidence: [],
    });
    setup({
      launches: [launch({ progress: 'running', evidence: [], report: undefined as never })],
      onOpenGoal: vi.fn(),
      onOpenFeed: vi.fn(),
      taskLaunch: async () => launch({ progress: 'running', evidence: [] }),
    });
    const running = await status();
    expect(running.getByRole('button', { name: 'Open goal' })).toBeTruthy();
    expect(running.queryByRole('button', { name: 'Open in Feed' })).toBeNull();
    cleanup();
    setup({ launches: [noGoal], onOpenGoal: vi.fn(), onOpenFeed: vi.fn() });
    const failed = await status();
    expect(failed.queryByRole('button')).toBeNull();
  });

  it('shows only the newest launch of a task on its card, and nothing on a card with no launch', async () => {
    setup({
      launches: [
        launch({ id: 'launch-2', progress: 'unverified', evidence: [] }),
        launch({ id: 'launch-1' }),
        launch({ id: 'launch-0', definitionId: 'other-task' }),
      ],
    });
    const shown = await status();
    expect(shown.getByText('Unverified')).toBeTruthy();
    expect(shown.queryByText('Completed (verified)')).toBeNull();
    cleanup();
    setup({ launches: [] });
    expect((await card()).queryByLabelText('Task status')).toBeNull();
  });

  it('marks the card a Feed report sent the person to', async () => {
    setup({ launches: [launch()], focusLaunch: 'launch-1' });
    expect((await region()).getAttribute('aria-current')).toBe('true');
    cleanup();
    setup({ launches: [launch()], focusLaunch: 'launch-other' });
    expect((await region()).getAttribute('aria-current')).toBeNull();
  });
});

describe('reading a launch that is still going', () => {
  it('reads it again every few seconds, shows each state as it arrives, and stops at the first end', async () => {
    const states = [
      launch({ progress: 'running', reason: 'Working.', evidence: [], report: undefined as never }),
      launch({ progress: 'waiting', reason: 'Waiting.', evidence: [], report: undefined as never }),
      launch(),
    ];
    const { taskLaunch } = setup({
      launches: [launch({ progress: 'starting', reason: 'Getting going.', evidence: [] })],
      taskLaunch: async () => states[Math.min(taskLaunch.mock.calls.length - 1, 2)]!,
    });
    await (await card()).findByLabelText('Task status');
    await later(0);
    expect(taskLaunch).toHaveBeenCalledTimes(1);
    expect((await status()).getByText('Running')).toBeTruthy();
    await later(LAUNCH_REFRESH_MS);
    expect(taskLaunch).toHaveBeenCalledTimes(2);
    expect((await status()).getByText('Waiting for you')).toBeTruthy();
    await later(LAUNCH_REFRESH_MS);
    expect(taskLaunch).toHaveBeenCalledTimes(3);
    expect((await status()).getByText('Completed (verified)')).toBeTruthy();
    // At an end it is not asked about again, however long the page stays open.
    await later(LAUNCH_REFRESH_MS * 20);
    expect(taskLaunch).toHaveBeenCalledTimes(3);
    expect(taskLaunch).toHaveBeenCalledWith('launch-1');
  });

  it('does not read a launch the page already knows has ended', async () => {
    const { taskLaunch } = setup({ launches: [launch({ progress: 'unverified', evidence: [] })] });
    await status();
    await later(LAUNCH_REFRESH_MS * 5);
    expect(taskLaunch).not.toHaveBeenCalled();
  });

  it('reads a launch at once when the person starts it from the card, and then as it goes', async () => {
    const states = [
      launch({
        progress: 'starting',
        reason: 'Getting going.',
        evidence: [],
        report: undefined as never,
      }),
      launch({ progress: 'unverified', reason: 'It ended with nothing recorded.', evidence: [] }),
    ];
    const { api, taskLaunch } = setup({
      taskLaunch: async () => states[Math.min(taskLaunch.mock.calls.length - 1, 1)]!,
    });
    const scope = await card();
    fireEvent.change(scope.getByLabelText(/Page address/u), { target: { value: PAGE } });
    fireEvent.change(scope.getByLabelText(/What to check/u), { target: { value: 'Is it free?' } });
    fireEvent.click(scope.getByRole('button', { name: 'Start' }));
    expect(
      await within(await scope.findByLabelText('Task status')).findByText('Starting'),
    ).toBeTruthy();
    expect(api.startTask).toHaveBeenCalledTimes(1);
    expect(taskLaunch).toHaveBeenCalledWith('launch-1');
    await later(LAUNCH_REFRESH_MS);
    expect(within(scope.getByLabelText('Task status')).getByText('Unverified')).toBeTruthy();
    await later(LAUNCH_REFRESH_MS * 5);
    expect(taskLaunch).toHaveBeenCalledTimes(2);
  });

  it('keeps reading after a read fails, says so, and shows the launch again when one succeeds', async () => {
    let attempts = 0;
    setup({
      launches: [launch({ progress: 'running', reason: 'Working.', evidence: [] })],
      taskLaunch: async () => {
        attempts += 1;
        if (attempts === 2) throw new Error('The agent is not reachable');
        return launch({ progress: attempts === 1 ? 'running' : 'verified', reason: 'Working.' });
      },
    });
    await status();
    await later(0);
    await later(LAUNCH_REFRESH_MS);
    expect((await status()).getByRole('alert').textContent).toBe('The agent is not reachable');
    // The launch stays as it was shown, and the next read puts it right.
    expect((await status()).getByText('Running')).toBeTruthy();
    await later(LAUNCH_REFRESH_MS);
    expect((await status()).getByText('Completed (verified)')).toBeTruthy();
    expect((await card()).queryByRole('alert')).toBeNull();
  });

  it('stops reading when the person leaves the page', async () => {
    const { taskLaunch } = setup({
      launches: [launch({ progress: 'running', evidence: [] })],
      taskLaunch: async () => launch({ progress: 'running', evidence: [] }),
    });
    await status();
    await later(0);
    const before = taskLaunch.mock.calls.length;
    cleanup();
    await later(LAUNCH_REFRESH_MS * 10);
    expect(taskLaunch).toHaveBeenCalledTimes(before);
  });
});

describe('the Feed and the card point at each other', () => {
  const report = (change: Partial<IFeedItemView> = {}): IFeedItemView => ({
    id: 'feed-1',
    at: '2026-11-24T10:00:09.000Z',
    kind: 'report',
    title: 'Check a fact on a page',
    body: 'Yes. The page says: free shipping.',
    goalId: 'goal-1',
    launchId: 'launch-1',
    ...change,
  });

  function feed(
    items: readonly IFeedItemView[],
    props: {
      focusLaunch?: string;
      launches?: readonly ITaskLaunchStatusView[] | Error;
    } = {},
  ) {
    const onOpenTask = vi.fn();
    const taskLaunches = vi.fn(async () => {
      if (props.launches instanceof Error) throw props.launches;
      return props.launches ?? [];
    });
    const api = { feed: async () => items, taskLaunches } as unknown as IPersonalApi;
    render(
      <FeedView
        api={api}
        onOpenGoal={() => undefined}
        onOpenTask={onOpenTask}
        {...(props.focusLaunch !== undefined && { focusLaunch: props.focusLaunch })}
      />,
    );
    return { onOpenTask, taskLaunches };
  }

  const itemOf = async (title: string) =>
    within((await screen.findByRole('heading', { name: title })).closest('li')!);

  it('names the task a report came from and opens its card', async () => {
    const { onOpenTask } = feed([
      report(),
      report({ id: 'feed-2', launchId: undefined, goalId: 'goal-2' }),
    ]);
    const buttons = await screen.findAllByRole('button', { name: 'Open task' });
    expect(buttons).toHaveLength(1);
    expect(screen.getAllByText('From a task you started in Browse.')).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith('launch-1');
  });

  it('marks the report of the launch whose card sent the person here, and no other', async () => {
    feed([report(), report({ id: 'feed-2', launchId: 'launch-2', goalId: 'goal-2' })], {
      focusLaunch: 'launch-1',
    });
    await screen.findAllByRole('button', { name: 'Open task' });
    const marked = document.querySelectorAll('[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('Check a fact on a page');
    expect(marked[0]!.textContent).toContain('Yes. The page says');
  });

  it('shows the report of a started task as the plain text it is, and an ordinary report as it always was', async () => {
    const hostile =
      '**bold** [link](https://evil.example) <img src=x onerror=alert(1)> `code`\n\n- one\n- two';
    feed([
      report({ title: 'Started task', body: hostile }),
      report({ id: 'feed-2', title: 'Ordinary goal', body: hostile, launchId: undefined }),
    ]);
    const started = await itemOf('Started task');
    expect(started.getByText(/\*\*bold\*\* \[link\]\(https:\/\/evil\.example\)/u)).toBeTruthy();
    const startedItem = (await screen.findByRole('heading', { name: 'Started task' })).closest(
      'li',
    )!;
    expect(startedItem.querySelector('a, img, strong, code, ul, li li')).toBeNull();
    expect(startedItem.textContent).toContain('`code`');
    expect(startedItem.textContent).toContain('- one');
    // The ordinary report keeps its markdown.
    const ordinary = (await screen.findByRole('heading', { name: 'Ordinary goal' })).closest('li')!;
    expect(ordinary.querySelector('strong')).not.toBeNull();
  });

  it('says where a started task stands on its item, so an unchecked run does not look like a checked one', async () => {
    feed(
      [
        report({ id: 'feed-1', title: 'Checked task', launchId: 'launch-1' }),
        report({ id: 'feed-2', title: 'Unchecked task', launchId: 'launch-2' }),
        report({ id: 'feed-3', title: 'Failed task', launchId: 'launch-3' }),
      ],
      {
        launches: [
          launch({ id: 'launch-1', progress: 'verified' }),
          launch({ id: 'launch-2', progress: 'unverified' }),
          launch({ id: 'launch-3', progress: 'failed' }),
        ],
      },
    );
    const checked = await itemOf('Checked task');
    await checked.findByText('Completed (verified)');
    const unchecked = await itemOf('Unchecked task');
    await unchecked.findByText('Unverified');
    expect(unchecked.queryByText('Completed (verified)')).toBeNull();
    expect(checked.queryByText('Unverified')).toBeNull();
    expect((await itemOf('Failed task')).getByText('Failed')).toBeTruthy();
    // Where it stands is known, so the item does not ask the person to go and see.
    for (const view of [checked, unchecked])
      expect(view.queryByText('Open the task to see whether this was checked.')).toBeNull();
  });

  it('asks the person to open the task when the agent has not said where it stands, and only on an item of a started task', async () => {
    const { taskLaunches } = feed([
      report({ id: 'feed-1', title: 'Started task' }),
      report({ id: 'feed-2', title: 'Ordinary goal', launchId: undefined, goalId: 'goal-2' }),
    ]);
    const started = await itemOf('Started task');
    await started.findByText('Open the task to see whether this was checked.');
    expect(taskLaunches).toHaveBeenCalled();
    const ordinary = await itemOf('Ordinary goal');
    expect(ordinary.queryByText('Open the task to see whether this was checked.')).toBeNull();
    expect(ordinary.queryByText(/From a task you started/u)).toBeNull();
    expect(ordinary.queryByText('Unverified')).toBeNull();
  });

  it('asks the person to open the task when where it stands cannot be read, and does not ask for it for a feed with no started task', async () => {
    const { taskLaunches } = feed([report()], {
      launches: new Error('The agent is not reachable'),
    });
    const started = await itemOf('Check a fact on a page');
    await started.findByText('Open the task to see whether this was checked.');
    expect(started.queryByRole('alert')).toBeNull();
    cleanup();
    const plain = feed([report({ launchId: undefined })]);
    await screen.findByText('Check a fact on a page');
    expect(plain.taskLaunches).not.toHaveBeenCalled();
    expect(taskLaunches).toHaveBeenCalled();
  });
});
