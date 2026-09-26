// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionSidebar } from '../SessionSidebar.js';

import type { IWsSessionState, TSessionListing } from '../../hooks/session-client-types.js';

/**
 * #3189 — a host that keeps several sessions live says which rows run now and how many clients are
 * on each. The count on this surface's own row leaves this surface out: it reads "others".
 */

function row(id: string, preview: string, extra: { live?: boolean; clients?: number } = {}) {
  return { id, cwd: '/w', updatedAt: '2026-09-26T00:00:00.000Z', messageCount: 1, preview, ...extra };
}

function renderSidebar(listing: TSessionListing): void {
  const state = {
    sessionListing: listing,
    sessionsError: null,
    setSessionSidebarOpen: () => undefined,
    newSession: () => undefined,
    switchSession: () => undefined,
  } as unknown as IWsSessionState;
  render(<SessionSidebar state={state} />);
}

const sessionRow = (name: RegExp): HTMLElement =>
  within(screen.getByRole('complementary', { name: 'Sessions' })).getByRole('button', { name });

afterEach(cleanup);

describe('SessionSidebar — live sessions and their clients', () => {
  it('marks live rows and counts the other clients, leaving this surface out of its own row', () => {
    renderSidebar({
      currentSessionId: 'mine',
      sessions: [
        row('mine', 'my session', { live: true, clients: 3 }),
        row('shared', 'shared session', { live: true, clients: 1 }),
        row('alone', 'only me here', { live: true, clients: 1 }),
        row('stored', 'stored only', { live: false, clients: 0 }),
      ],
      unreadableSessionIds: [],
    });
    // The current row counts 3 clients, one of them this surface.
    expect(sessionRow(/my session/).textContent).toContain('2 others');
    expect(within(sessionRow(/my session/)).getByTitle('Live in the host')).toBeTruthy();
    // Another row's clients are all others.
    expect(sessionRow(/shared session/).textContent).toContain('1 other');
    expect(sessionRow(/shared session/).textContent).not.toContain('1 others');
    expect(within(sessionRow(/stored only/)).queryByTitle('Live in the host')).toBeNull();
    expect(sessionRow(/stored only/).textContent).not.toMatch(/other/);
  });

  it('shows no count for the current row when this surface is its only client', () => {
    renderSidebar({
      currentSessionId: 'alone',
      sessions: [row('alone', 'only me here', { live: true, clients: 1 })],
      unreadableSessionIds: [],
    });
    expect(sessionRow(/only me here/).textContent).not.toMatch(/other/);
  });

  it('an older host sends neither field: rows show neither badge', () => {
    renderSidebar({
      currentSessionId: 'a',
      sessions: [row('a', 'plain'), row('b', 'plain too')],
      unreadableSessionIds: [],
    });
    expect(screen.queryByTitle('Live in the host')).toBeNull();
    expect(screen.queryByText(/other/)).toBeNull();
  });
});
