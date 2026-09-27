// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConversationView } from '../ConversationView.js';

import { AGENT_DRIVER_ID } from '@robota-sdk/agent-interface-session';

/**
 * #3288 §1: a turn a self-paced or fixed loop injected carries `driverId: AGENT_DRIVER_ID` (never
 * the owner's own id) — the SAME reserved id for every agent-wakeup turn (loops are, today, the only
 * caller of that path — see requestWakeup in interactive-session.ts). It must never show as a raw
 * "from agent" driver-id chip; it reads as "Automatic — loop".
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('ConversationView — the injected loop turn\'s label (#3288 §1)', () => {
  it('shows "Automatic — loop" for a turn authored by the reserved agent-wakeup driver id', () => {
    render(
      <ConversationView
        messages={[{ id: 'm1', role: 'user', content: 'check the deploy', author: AGENT_DRIVER_ID }]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByText('Automatic — loop')).toBeTruthy();
    expect(screen.queryByText(`from ${AGENT_DRIVER_ID}`)).toBeNull();
  });

  it('still shows an ordinary co-driver as "from <id>"', () => {
    render(
      <ConversationView
        messages={[{ id: 'm1', role: 'user', content: 'hi', author: 'peer:device-123456789' }]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByText(/^from /)).toBeTruthy();
    expect(screen.queryByText('Automatic — loop')).toBeNull();
  });

  it('shows nothing for the local owner\'s own message', () => {
    render(
      <ConversationView
        messages={[{ id: 'm1', role: 'user', content: 'hi', author: 'owner' }]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.queryByText(/^from /)).toBeNull();
    expect(screen.queryByText('Automatic — loop')).toBeNull();
  });
});
