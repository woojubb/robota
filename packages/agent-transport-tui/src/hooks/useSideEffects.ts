/**
 * CMD-004 Phase 2 Stage C — the TUI as a pure renderer.
 *
 * The session layer (the host) executes every command host action via `ICommandHostAdapters`
 * BEFORE the command result returns (language change, settings reset, exit/restart, rename,
 * statusline patch, remote control — see `interactive-session-host-actions.ts`). This hook only:
 *
 * 1. renders the four UI screens from the requester-routed `ui_intent` session event
 *    (`show-plugin-manager` / `show-settings` / `show-session-picker` / `show-agent-switcher`) —
 *    the surface that issued the command renders the intent; intents stamped with another
 *    surface's driver id (or unattributed) are ignored;
 * 2. reflects the broadcast `session_renamed` event into the rendered title (the host performed
 *    the rename — the TUI never mutates the session);
 * 3. refreshes the statusline display after a slash-command result arrives by RE-READING the
 *    persisted settings (refresh-on-result — the host applied any patch via the settings adapter).
 */

import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-transport';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { IUseSideEffectsOptions, IUseSideEffectsResult } from './side-effects-types.js';
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type { ISessionRenamedEvent, IUiIntentEvent } from '@robota-sdk/agent-interface-transport';

interface IUiEventHandlers {
  setSessionName: (name: string) => void;
  refreshStatusLineSettings: () => void;
  openAgentSwitcher?: (() => void) | undefined;
}

interface IScreenSetters {
  setShowPluginTUI: (show: boolean) => void;
  setShowTransportTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
}

/** Subscribe to `ui_intent` (requester-routed) + `session_renamed` (broadcast); returns cleanup. */
function subscribeToSessionUiEvents(
  interactiveSession: InteractiveSession,
  screens: IScreenSetters,
  handlersRef: { current: IUiEventHandlers },
): () => void {
  const onUiIntent = (event: IUiIntentEvent): void => {
    // Requester-routed: this surface is the local operator (OWNER_DRIVER_ID). Intents issued by
    // other surfaces — or unattributed ones — are theirs to render, not ours.
    if (event.requesterDriverId !== OWNER_DRIVER_ID) return;
    switch (event.intent.type) {
      case 'show-plugin-manager':
        screens.setShowPluginTUI(true);
        return;
      case 'show-settings':
        screens.setShowTransportTUI(true);
        return;
      case 'show-session-picker':
        screens.setShowSessionPicker(true);
        return;
      case 'show-agent-switcher':
        handlersRef.current.openAgentSwitcher?.();
        return;
    }
  };
  const onSessionRenamed = (event: ISessionRenamedEvent): void => {
    handlersRef.current.setSessionName(event.name);
  };
  interactiveSession.on('ui_intent', onUiIntent);
  interactiveSession.on('session_renamed', onSessionRenamed);
  return () => {
    interactiveSession.off('ui_intent', onUiIntent);
    interactiveSession.off('session_renamed', onSessionRenamed);
  };
}

export function useSideEffects({
  interactiveSession,
  baseHandleSubmit,
  setSessionName,
  refreshStatusLineSettings,
  showSessionPickerOnStart,
  openAgentSwitcher,
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(showSessionPickerOnStart ?? false);
  const [showTransportTUI, setShowTransportTUI] = useState(false);

  // Latest-callback refs so the session subscription binds exactly once per session (App recreates
  // some callbacks every render; re-subscribing on each identity change would churn listeners).
  const handlersRef = useRef({ setSessionName, refreshStatusLineSettings, openAgentSwitcher });
  handlersRef.current = { setSessionName, refreshStatusLineSettings, openAgentSwitcher };

  useEffect(
    () =>
      subscribeToSessionUiEvents(
        interactiveSession,
        { setShowPluginTUI, setShowTransportTUI, setShowSessionPicker },
        handlersRef,
      ),
    [interactiveSession],
  );

  const handleSubmit = useCallback(
    async (input: string): Promise<void> => {
      await baseHandleSubmit(input);
      // Refresh-on-result: a slash command's result has arrived; the host may have patched the
      // persisted statusline settings — re-read them for the status bar.
      if (input.trimStart().startsWith('/')) {
        handlersRef.current.refreshStatusLineSettings();
      }
    },
    [baseHandleSubmit],
  );

  return {
    handleSubmit,
    showPluginTUI,
    showSessionPicker,
    showTransportTUI,
    setShowPluginTUI,
    setShowSessionPicker,
    setShowTransportTUI,
  };
}
