'use client';

import { Check, X } from 'lucide-react';
import React from 'react';

import { Dialog } from './Dialog.js';

import type { IWsSessionState } from '../hooks/useSessionClient.js';

/**
 * #3282 §4 part b-3 — the agent switcher: `show-agent-switcher` (`/agent` with no args) opens this
 * sheet instead of the surface's old "not available" line. It lists every agent this session can
 * run — name, one-line description, and where each is defined in plain words — with the current one
 * checked. Choosing a row runs the SAME path as typing `/agent <name>` (a plain `command`, wired in
 * `useAgentSwitcherState`); the reply is this sheet's own confirmation line, never a conversation
 * card (issue #3282 §4's decided design).
 */
export function AgentSwitcherSheet({ state }: { state: IWsSessionState }): React.ReactElement | null {
  if (!state.agentSwitcherOpen) return null;

  const loading = state.agentSwitcherStatus === 'loading' && state.agentDefinitions.length === 0;

  return (
    <Dialog
      open
      onClose={() => state.closeAgentSwitcher()}
      title="Switch agent"
      panelClassName="flex max-h-[min(560px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none"
    >
      <div className="flex h-12 flex-shrink-0 items-center gap-1 border-b border-border px-3">
        <h2 className="px-1.5 text-[15px] font-semibold text-foreground">Switch agent</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => state.closeAgentSwitcher()}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <X size={17} strokeWidth={1.75} />
        </button>
      </div>

      {state.agentSwitchMessage ? (
        <p
          role="status"
          className="mx-4 mt-3 rounded-lg bg-raised px-3 py-2 text-[13px] text-foreground"
        >
          {state.agentSwitchMessage}
        </p>
      ) : null}

      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <li className="px-3 py-4 text-[13.5px] text-muted-foreground">Loading agents…</li>
        ) : state.agentDefinitions.length === 0 ? (
          <li className="px-3 py-4 text-[13.5px] text-muted-foreground">
            No agents are configured on this host.
          </li>
        ) : (
          state.agentDefinitions.map((agent) => {
            const isCurrent = agent.name === state.currentAgentType;
            return (
              <li key={agent.name}>
                <button
                  type="button"
                  onClick={() => state.selectAgent(agent.name)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-hover"
                >
                  <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {isCurrent ? (
                      <Check size={16} strokeWidth={2} className="text-accent" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-foreground">
                      {agent.name}
                    </span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {agent.description}
                    </span>
                    <span className="block truncate text-[12px] text-subtle">
                      {agent.definedIn}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Dialog>
  );
}
