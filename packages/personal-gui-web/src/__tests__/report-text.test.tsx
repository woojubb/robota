// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FeedView } from '../views/Feed.js';
import { GoalsView } from '../views/Goals.js';

import type { IFeedItemView, IGoalRunView, IGoalView, IPersonalApi } from '../api.js';

afterEach(cleanup);

const REPORT = '**Now:** 11 °C, sunny\n\n- Today: high 16\n- Rain: none';

function feedApi(items: readonly IFeedItemView[]): IPersonalApi {
  return { feed: async () => items } as unknown as IPersonalApi;
}

describe('what the agent wrote in the feed', () => {
  it('shows a report as formatted text', async () => {
    render(
      <FeedView
        api={feedApi([
          { id: 'a', at: '2026-11-15T01:00:00Z', kind: 'report', title: 'Weather', body: REPORT },
        ])}
        onOpenGoal={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText('Now:').tagName).toBe('STRONG'));
    expect(screen.getByText('Today: high 16').tagName).toBe('LI');
  });

  it('shows what an approval would send exactly as written', async () => {
    render(
      <FeedView
        api={feedApi([
          {
            id: 'b',
            at: '2026-11-15T01:00:00Z',
            kind: 'approval',
            title: 'Send a message',
            body: 'Send **this** to Mina',
            approval: { tool: 'BrowserSubmit', detail: 'POST /send', state: 'pending' },
          },
        ])}
        onOpenGoal={() => undefined}
      />,
    );
    await waitFor(() => expect(screen.getByText('Send **this** to Mina')).toBeTruthy());
  });
});

describe('a goal run report', () => {
  it('is shown as formatted text', async () => {
    const goal: IGoalView = {
      id: 'g',
      title: 'Morning weather',
      instructions: 'Look up the weather.',
      readOnly: true,
      status: 'active',
      createdAt: '2026-11-15T00:00:00Z',
    };
    const run: IGoalRunView = {
      id: 'r',
      startedAt: '2026-11-15T01:00:00Z',
      outcome: 'done',
      report: REPORT,
      actions: [],
    };
    const api = {
      goals: async () => [goal],
      goal: async () => ({ goal, runs: [run] }),
    } as unknown as IPersonalApi;
    render(<GoalsView api={api} openGoal="g" onOpenGoal={() => undefined} />);
    await waitFor(() => expect(screen.getByText('Now:').tagName).toBe('STRONG'));
    expect(screen.getByText('Today: high 16').tagName).toBe('LI');
  });
});
