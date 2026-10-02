// @vitest-environment jsdom
/**
 * #3282 §4 part b-3 — the agent switcher sheet: lists the available agents (name, one-line
 * description, where each is defined), checks the current one, and choosing a row runs the same
 * path as `/agent <name>` — never a form the sheet builds its own write around.
 */
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentSwitcherSheet } from '../AgentSwitcherSheet.js';

import type { IWsSessionState } from '../../hooks/session-client-types.js';

afterEach(cleanup);

const agents = [
  { name: 'general-purpose', description: 'General-purpose task execution agent.', definedIn: 'Built-in' },
  { name: 'Explore', description: 'Read-only codebase exploration agent.', definedIn: 'Built-in' },
  {
    name: 'security-reviewer',
    description: 'Reviews code for security vulnerabilities.',
    definedIn: '.claude/agents/security-reviewer.md',
  },
];

function buildState(overrides: Partial<IWsSessionState> = {}): IWsSessionState {
  return {
    agentSwitcherOpen: true,
    agentSwitcherStatus: 'ready',
    agentDefinitions: agents,
    currentAgentType: 'general-purpose',
    agentSwitchMessage: null,
    openAgentSwitcher: vi.fn(),
    closeAgentSwitcher: vi.fn(),
    selectAgent: vi.fn(),
    ...overrides,
  } as unknown as IWsSessionState;
}

describe('AgentSwitcherSheet — presentation', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AgentSwitcherSheet state={buildState({ agentSwitcherOpen: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists every agent with its name, one-line description, and where it is defined', () => {
    render(<AgentSwitcherSheet state={buildState()} />);
    expect(screen.getByRole('dialog', { name: 'Switch agent' })).toBeTruthy();
    for (const agent of agents) {
      expect(screen.getByText(agent.name)).toBeTruthy();
      expect(screen.getByText(agent.description)).toBeTruthy();
      expect(screen.getAllByText(agent.definedIn).length).toBeGreaterThan(0);
    }
  });

  it('checks the current agent, and no other', () => {
    render(<AgentSwitcherSheet state={buildState({ currentAgentType: 'Explore' })} />);
    expect(
      screen.getByRole('button', { name: /Explore/ }).getAttribute('aria-current'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /general-purpose/ }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('a host with no agents configured says so, not an empty list', () => {
    render(<AgentSwitcherSheet state={buildState({ agentDefinitions: [], currentAgentType: null })} />);
    expect(screen.getByText(/no agents are configured/i)).toBeTruthy();
  });

  it('a loading roster says so', () => {
    render(
      <AgentSwitcherSheet
        state={buildState({ agentSwitcherStatus: 'loading', agentDefinitions: [], currentAgentType: null })}
      />,
    );
    expect(screen.getByText(/loading agents/i)).toBeTruthy();
  });
});

describe('AgentSwitcherSheet — choosing an agent', () => {
  it('sends the same path `/agent <name>` runs, never a bespoke write', () => {
    const selectAgent = vi.fn();
    render(<AgentSwitcherSheet state={buildState({ selectAgent })} />);
    fireEvent.click(screen.getByRole('button', { name: /Explore/ }));
    expect(selectAgent).toHaveBeenCalledExactlyOnceWith('Explore');
  });

  it("shows the switch's plain confirmation, not a conversation card", () => {
    render(<AgentSwitcherSheet state={buildState({ agentSwitchMessage: 'Default agent: Explore' })} />);
    expect(screen.getByRole('status').textContent).toBe('Default agent: Explore');
  });

  it('closing calls closeAgentSwitcher', () => {
    const closeAgentSwitcher = vi.fn();
    render(<AgentSwitcherSheet state={buildState({ closeAgentSwitcher })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closeAgentSwitcher).toHaveBeenCalledOnce();
  });
});
