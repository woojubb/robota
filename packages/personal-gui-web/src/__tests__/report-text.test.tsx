// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FeedView } from '../views/Feed.js';
import { GoalsView } from '../views/Goals.js';
import { IdeasView } from '../views/Ideas.js';
import { SpaceView } from '../views/Spaces.js';

import type {
  IFeedItemView,
  IGoalRunView,
  IGoalView,
  IIdeaView,
  IPersonalApi,
  ISpaceView,
} from '../api.js';

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

describe('an idea', () => {
  const idea = (origin: 'owner' | 'agent'): IIdeaView => ({
    id: origin,
    text: 'Try the **night ferry**',
    tags: [],
    origin,
    status: 'open',
    createdAt: '2026-11-15T00:00:00Z',
  });
  const ideasApi = (ideas: readonly IIdeaView[]): IPersonalApi =>
    ({ ideas: async () => ideas }) as unknown as IPersonalApi;

  it('the agent suggested is shown as formatted text', async () => {
    render(<IdeasView api={ideasApi([idea('agent')])} onOpenGoal={() => undefined} />);
    await waitFor(() => expect(screen.getByText('night ferry').tagName).toBe('STRONG'));
  });

  it('the person typed is shown exactly as written', async () => {
    render(<IdeasView api={ideasApi([idea('owner')])} onOpenGoal={() => undefined} />);
    await waitFor(() => expect(screen.getByText('Try the **night ferry**')).toBeTruthy());
  });
});

describe('an idea in a space', () => {
  const space: ISpaceView = {
    id: 's',
    name: 'Jeju trip',
    instructions: 'Keep answers short.',
    tag: 'jeju',
    pinned: [],
    opening: 'Let us plan.',
  };
  const idea = (origin: 'owner' | 'agent'): IIdeaView => ({
    id: origin,
    text: 'Try the **night ferry**',
    tags: ['jeju'],
    origin,
    status: 'open',
    createdAt: '2026-11-15T00:00:00Z',
  });
  const spaceApi = (ideas: readonly IIdeaView[]): IPersonalApi =>
    ({
      spaces: async () => [space],
      listPages: async () => [],
      ideas: async () => ideas,
    }) as unknown as IPersonalApi;
  const view = (ideas: readonly IIdeaView[]): React.ReactElement => (
    <SpaceView
      api={spaceApi(ideas)}
      spaceId="s"
      onStartChat={() => undefined}
      onChanged={() => undefined}
      onRemoved={() => undefined}
    />
  );

  it('the agent suggested is shown as formatted text', async () => {
    render(view([idea('agent')]));
    await waitFor(() => expect(screen.getByText('night ferry').tagName).toBe('STRONG'));
  });

  it('the person typed is shown exactly as written', async () => {
    render(view([idea('owner')]));
    await waitFor(() => expect(screen.getByText('Try the **night ferry**')).toBeTruthy());
  });
});
