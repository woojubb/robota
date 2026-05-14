import { useState, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import type { ICommandInteraction, ICommandResult } from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { TSessionEndReason } from '@robota-sdk/agent-core';
import type { TInteractivePrompt } from './side-effects-types.js';
import type { IUseSideEffectsOptions, IUseSideEffectsResult } from './side-effects-types.js';
import { applyCommandEffects } from './command-effect-handler.js';
import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';
import {
  addModelChangeCancelledMessage,
  applyConfirmedModelChange,
} from './model-change-side-effect.js';

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
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingInteractionPrompt, setPendingInteractionPrompt] =
    useState<TInteractivePrompt | null>(null);
  const commandInteractionRef = useRef<ICommandInteraction | null>(null);
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
        requestModelChange: (modelId) => {
          pendingModelChangeRef.current = modelId;
          setPendingModelId(modelId);
        },
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

  const applyCommandResult = useCallback(
    (result: ICommandResult): void => {
      if (result.message.length > 0) {
        addEntry(messageToHistoryEntry(createSystemMessage(result.message)));
      }
      if (result.interaction !== undefined) {
        commandInteractionRef.current = result.interaction;
        setPendingInteractionPrompt(result.interaction.prompt);
        return;
      }
      commandInteractionRef.current = null;
      setPendingInteractionPrompt(null);
      if (result.effects !== undefined && result.effects.length > 0) {
        applyEffects(result.effects);
      }
    },
    [addEntry, applyEffects],
  );

  const applyQueuedCommandState = useCallback((): boolean => {
    const queued = commandEffectQueue.drain();
    if (queued === undefined) {
      return false;
    }
    if (queued.type === 'interaction') {
      const { interaction } = queued;
      commandInteractionRef.current = interaction;
      setPendingInteractionPrompt(interaction.prompt);
      return true;
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

  const handleModelConfirm = useCallback(
    (index: number) => {
      const modelId = pendingModelChangeRef.current;
      setPendingModelId(null);
      pendingModelChangeRef.current = null;
      if (index === 0 && modelId) {
        applyConfirmedModelChange({
          cwd,
          modelId,
          providerOverride,
          addEntry,
          requestShutdown,
          applyModelChange: (c, m, opts) => {
            cliAdapter.applyActiveModelChange(c, m, opts);
            return { applied: true };
          },
        });
      } else {
        addModelChangeCancelledMessage(addEntry);
      }
    },
    [cwd, providerOverride, addEntry, cliAdapter, requestShutdown],
  );

  const handleInteractionSubmit = useCallback(
    async (value: string): Promise<void> => {
      const interaction = commandInteractionRef.current;
      if (interaction === null) {
        setPendingInteractionPrompt(null);
        return;
      }
      try {
        // allow-fallback: user-facing error display for plugin interaction submit
        const result = await interaction.submit(value);
        applyCommandResult(result);
      } catch (err) {
        // allow-fallback: user-facing error display for plugin interaction submit
        commandInteractionRef.current = null;
        setPendingInteractionPrompt(null);
        addEntry(
          messageToHistoryEntry(
            createSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
        );
      }
    },
    [addEntry, applyCommandResult],
  );

  const handleInteractionCancel = useCallback(() => {
    const interaction = commandInteractionRef.current;
    commandInteractionRef.current = null;
    setPendingInteractionPrompt(null);
    if (interaction?.cancel === undefined) {
      addEntry(messageToHistoryEntry(createSystemMessage('Command interaction cancelled.')));
      return;
    }
    Promise.resolve(interaction.cancel())
      .then((result) => applyCommandResult(result))
      .catch((err) => {
        // allow-fallback: user-facing error display for interaction cancel
        addEntry(
          messageToHistoryEntry(
            createSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
        );
      });
  }, [addEntry, applyCommandResult]);

  return {
    handleSubmit,
    pendingModelId,
    pendingInteractionPrompt,
    showPluginTUI,
    showSessionPicker,
    showTransportTUI,
    setPendingModelId,
    setShowPluginTUI,
    setShowSessionPicker,
    setShowTransportTUI,
    handleModelConfirm,
    handleInteractionSubmit,
    handleInteractionCancel,
  };
}
