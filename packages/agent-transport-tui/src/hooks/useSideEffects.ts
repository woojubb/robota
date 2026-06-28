import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useApp } from 'ink';
import { useState, useCallback } from 'react';

import { applyCommandEffects } from './command-effect-handler.js';
import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';

import type { IUseSideEffectsOptions, IUseSideEffectsResult } from './side-effects-types.js';
import type { TSessionEndReason } from '@robota-sdk/agent-core';

const EXIT_DELAY_MS = 500;

export function useSideEffects({
  cwd,
  providerOverride,
  interactiveSession,
  commandEffectQueue,
  addEntry,
  baseHandleSubmit,
  setSessionName,
  setStatusLineSettings,
  showSessionPickerOnStart,
  openAgentSwitcher,
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const { exit } = useApp();
  const cliAdapter = useTuiCliAdapter();
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(showSessionPickerOnStart ?? false);
  const [showTransportTUI, setShowTransportTUI] = useState(false);

  const requestShutdown = useCallback(
    (reason: TSessionEndReason, message: string): void => {
      addEntry(messageToHistoryEntry(createSystemMessage('Shutting down...')));
      setTimeout(() => {
        void interactiveSession.shutdown({ reason, message }).finally(() => exit());
      }, EXIT_DELAY_MS);
    },
    [interactiveSession, addEntry, exit],
  );

  const applyEffects = useCallback(
    (effects: Parameters<typeof applyCommandEffects>[0]): boolean =>
      applyCommandEffects(effects, {
        addEntry,
        requestShutdown,
        openPluginTUI: () => setShowPluginTUI(true),
        openSessionPicker: () => setShowSessionPicker(true),
        openTransportTUI: () => setShowTransportTUI(true),
        openAgentSwitcher: () => openAgentSwitcher?.(),
        renameSession: (name) => {
          interactiveSession.setName(name);
          setSessionName(name);
        },
        applyStatusLinePatch: (patch) => {
          setStatusLineSettings(
            cliAdapter.applyStatusLineSettings(cliAdapter.getUserSettingsPath(), patch),
          );
          return true;
        },
        cliAdapter,
      }),
    [
      addEntry,
      cliAdapter,
      interactiveSession,
      requestShutdown,
      setSessionName,
      setStatusLineSettings,
    ],
  );

  const applyQueuedCommandState = useCallback((): boolean => {
    const queued = commandEffectQueue.drain();
    if (queued === undefined) {
      return false;
    }
    return applyEffects(queued.effects);
  }, [applyEffects, commandEffectQueue]);

  const handleSubmit = useCallback(
    async (input: string): Promise<void> => {
      await baseHandleSubmit(input);
      applyQueuedCommandState();
    },
    [baseHandleSubmit, applyQueuedCommandState],
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
