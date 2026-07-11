import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useApp } from 'ink';
import { useState, useCallback } from 'react';

import { applyCommandEffects } from './command-effect-handler.js';
import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';

import type { IUseSideEffectsOptions, IUseSideEffectsResult } from './side-effects-types.js';
import type { IHistoryEntry, TSessionEndReason } from '@robota-sdk/agent-core';

const EXIT_DELAY_MS = 500;

/** REMOTE-008: resolve a composition-root enable/stop message (sync or async) and render it into history. */
function renderRemoteControlMessage(
  message: string | Promise<string>,
  addEntry: (entry: IHistoryEntry) => void,
): void {
  void Promise.resolve(message)
    .then((text) => addEntry(messageToHistoryEntry(createSystemMessage(text))))
    .catch((error: unknown) => {
      addEntry(
        messageToHistoryEntry(
          createSystemMessage(
            `Remote control failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      );
    });
}

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
  enableRemoteControl,
  stopRemoteControl,
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
        // REMOTE-008: run the composition-root enable/stop (returns a message) and render it into history.
        enableRemoteControl: enableRemoteControl
          ? () => void renderRemoteControlMessage(enableRemoteControl(), addEntry)
          : undefined,
        stopRemoteControl: stopRemoteControl
          ? () => void renderRemoteControlMessage(stopRemoteControl(), addEntry)
          : undefined,
        cliAdapter,
      }),
    [
      addEntry,
      cliAdapter,
      interactiveSession,
      requestShutdown,
      setSessionName,
      setStatusLineSettings,
      enableRemoteControl,
      stopRemoteControl,
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
