import { useCallback, useRef, useState } from 'react';

import type { IWsSessionState } from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { IWireAgentDefinitionSummary } from '@robota-sdk/agent-transport';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TAgentSwitcherState = Pick<
  IWsSessionState,
  | 'agentSwitcherOpen'
  | 'agentSwitcherStatus'
  | 'agentDefinitions'
  | 'currentAgentType'
  | 'agentSwitchMessage'
  | 'openAgentSwitcher'
  | 'closeAgentSwitcher'
  | 'selectAgent'
>;

let requestCounter = 0;
function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}_${requestCounter}_${Date.now()}`;
}

/**
 * #3282 §4 part b-3: the agent switcher sheet's own correlated request/response state, the same
 * shape `useSettingsState` already uses for `get-settings`/`update-settings` — independent from the
 * chat conversation, because choosing an agent is answered by the sheet's own confirmation line
 * ("Default agent: Explore"), never a conversation card (issue #3282 §4's decided design).
 *
 * `openAgentSwitcher` re-fetches every time (`/agent` bare, or reopening after a close), so a change
 * made elsewhere reaches an open-then-reopened sheet, matching `useSettingsState`'s own reasoning.
 *
 * Choosing an agent runs the SAME path as typing `/agent <name>` — a plain `command` wire message —
 * so the write goes through `executeCommand` exactly like every other command; this hook only
 * correlates its own request so the reply lands in the sheet, not the conversation. The central
 * `command_result` case in `useSessionClient` calls `resolveSwitchResult` to hand it the reply
 * (and, critically, still performs the shared `commandsInFlightRef` bookkeeping itself — this hook
 * never short-circuits `command_result` the way `handleAgentDefinitionsMessage` short-circuits reads).
 */
export function useAgentSwitcherState(send: (msg: TClientMessage) => void): TAgentSwitcherState & {
  /** Handles `agent_definitions` only — never `command_result` (see the note above). */
  handleAgentDefinitionsMessage: (msg: TServerMessage) => boolean;
  /**
   * Called from the central `command_result` case. Returns true when this requestId was the
   * sheet's own pending switch, meaning the central handler must not also add a conversation card.
   */
  resolveSwitchResult: (
    requestId: string | undefined,
    result: { success: boolean; message: string },
  ) => boolean;
} {
  const [agentSwitcherOpen, setAgentSwitcherOpen] = useState(false);
  const [agentSwitcherStatus, setAgentSwitcherStatus] =
    useState<IWsSessionState['agentSwitcherStatus']>('idle');
  const [agentDefinitions, setAgentDefinitions] = useState<
    readonly IWireAgentDefinitionSummary[]
  >([]);
  const [currentAgentType, setCurrentAgentType] = useState<string | null>(null);
  const [agentSwitchMessage, setAgentSwitchMessage] = useState<string | null>(null);
  const listRequestRef = useRef<string | null>(null);
  const switchRequestRef = useRef<string | null>(null);

  const handleAgentDefinitionsMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type !== 'agent_definitions') return false;
    if (listRequestRef.current !== msg.requestId) return true; // superseded by a later request
    setAgentDefinitions(msg.agents);
    setCurrentAgentType(msg.current);
    setAgentSwitcherStatus('ready');
    return true;
  }, []);

  const requestAgentDefinitions = useCallback((): void => {
    const requestId = nextRequestId('get_agent_definitions');
    listRequestRef.current = requestId;
    send({ type: 'get-agent-definitions', requestId });
  }, [send]);

  const openAgentSwitcher = useCallback((): void => {
    setAgentSwitcherOpen(true);
    setAgentSwitcherStatus((current) => (current === 'ready' ? 'ready' : 'loading'));
    setAgentSwitchMessage(null);
    requestAgentDefinitions();
  }, [requestAgentDefinitions]);

  const closeAgentSwitcher = useCallback((): void => {
    setAgentSwitcherOpen(false);
  }, []);

  const selectAgent = useCallback(
    (agentType: string): void => {
      const requestId = nextRequestId('agent_switch');
      switchRequestRef.current = requestId;
      setAgentSwitchMessage(null);
      // The SAME path `/agent <name>` runs: a plain command, not a dedicated write message.
      send({ type: 'command', name: 'agent', args: agentType, requestId });
    },
    [send],
  );

  const resolveSwitchResult = useCallback(
    (requestId: string | undefined, result: { success: boolean; message: string }): boolean => {
      if (requestId === undefined || switchRequestRef.current !== requestId) return false;
      switchRequestRef.current = null;
      setAgentSwitchMessage(result.message);
      if (result.success) requestAgentDefinitions();
      return true;
    },
    [requestAgentDefinitions],
  );

  return {
    agentSwitcherOpen,
    agentSwitcherStatus,
    agentDefinitions,
    currentAgentType,
    agentSwitchMessage,
    openAgentSwitcher,
    closeAgentSwitcher,
    selectAgent,
    handleAgentDefinitionsMessage,
    resolveSwitchResult,
  };
}
