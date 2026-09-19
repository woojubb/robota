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

import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { IUseSideEffectsOptions, IUseSideEffectsResult } from './side-effects-types.js';
import type { ITuiSessionUiEventPort } from '../tui-app-channel-port.js';
import type { ISessionRenamedEvent, IUiIntentEvent } from '@robota-sdk/agent-interface-session';

interface IUiEventHandlers {
  setSessionName: (name: string) => void;
  refreshStatusLineSettings: () => void;
  /** SCREEN-2002: re-read the persisted appearance after a slash command may have patched it. */
  refreshAppearanceSettings: () => void;
  openAgentSwitcher?: (() => void) | undefined;
}

interface IScreenSetters {
  setShowPluginTUI: (show: boolean) => void;
  setShowTransportTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  setShowThemePicker: (show: boolean) => void;
}

/** Subscribe to `ui_intent` (requester-routed) + `session_renamed` (broadcast); returns cleanup. */
function subscribeToSessionUiEvents(
  uiEventPort: ITuiSessionUiEventPort,
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
      case 'show-theme-picker':
        screens.setShowThemePicker(true);
        return;
    }
  };
  const onSessionRenamed = (event: ISessionRenamedEvent): void => {
    handlersRef.current.setSessionName(event.name);
  };
  uiEventPort.on('ui_intent', onUiIntent);
  uiEventPort.on('session_renamed', onSessionRenamed);
  return () => {
    uiEventPort.off('ui_intent', onUiIntent);
    uiEventPort.off('session_renamed', onSessionRenamed);
  };
}

/**
 * Latest-callback refs so the session subscription binds exactly once per session: App recreates
 * some callbacks every render, and re-subscribing on each identity change would churn listeners.
 */
function useLatestHandlers(handlers: IUiEventHandlers): { current: IUiEventHandlers } {
  const ref = useRef(handlers);
  ref.current = handlers;
  return ref;
}

export function useSideEffects({
  uiEventPort,
  baseHandleSubmit,
  setSessionName,
  refreshStatusLineSettings,
  refreshAppearanceSettings,
  showSessionPickerOnStart,
  openAgentSwitcher,
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(showSessionPickerOnStart ?? false);
  const [showTransportTUI, setShowTransportTUI] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);

  const handlersRef = useLatestHandlers({
    setSessionName,
    refreshStatusLineSettings,
    refreshAppearanceSettings,
    openAgentSwitcher,
  });

  useLayoutEffect(
    () =>
      subscribeToSessionUiEvents(
        uiEventPort,
        { setShowPluginTUI, setShowTransportTUI, setShowSessionPicker, setShowThemePicker },
        handlersRef,
      ),
    [uiEventPort],
  );

  const handleSubmit = useCallback(
    async (input: string): Promise<void> => {
      await baseHandleSubmit(input);
      // Refresh-on-result: a slash command's result has arrived; the host may have patched the
      // persisted statusline settings — re-read them for the status bar.
      if (input.trimStart().startsWith('/')) {
        handlersRef.current.refreshStatusLineSettings();
        handlersRef.current.refreshAppearanceSettings();
      }
    },
    [baseHandleSubmit],
  );

  return {
    handleSubmit,
    showPluginTUI,
    showSessionPicker,
    showTransportTUI,
    showThemePicker,
    setShowPluginTUI,
    setShowSessionPicker,
    setShowTransportTUI,
    setShowThemePicker,
  };
}
