import { useState, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import type {
  ICommandInteraction,
  ICommandResult,
  InteractiveSession,
} from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { TSessionEndReason } from '@robota-sdk/agent-core';
import type { TInteractivePrompt } from '../../utils/interactive-prompt.js';
import type {
  ISideEffects,
  IUseSideEffectsOptions,
  IUseSideEffectsResult,
} from './side-effects-types.js';
import { applyPendingStatusLinePatch } from './statusline-side-effect.js';
import { applyCommandEffects } from './command-effect-handler.js';
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
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const { exit } = useApp();
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingInteractionPrompt, setPendingInteractionPrompt] =
    useState<TInteractivePrompt | null>(null);
  const commandInteractionRef = useRef<ICommandInteraction | null>(null);
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(showSessionPickerOnStart ?? false);

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
    (effects: Parameters<typeof applyCommandEffects>[0], sideEffects: ISideEffects): boolean =>
      applyCommandEffects(effects, sideEffects, {
        addEntry,
        requestShutdown,
        requestModelChange: (modelId) => {
          pendingModelChangeRef.current = modelId;
          setPendingModelId(modelId);
        },
        openPluginTUI: () => setShowPluginTUI(true),
        openSessionPicker: () => setShowSessionPicker(true),
        renameSession: (name) => {
          interactiveSession.setName(name);
          setSessionName(name);
        },
        applyStatusLinePatch: () => applyPendingStatusLinePatch(sideEffects, setStatusLineSettings),
      }),
    [addEntry, interactiveSession, requestShutdown, setSessionName, setStatusLineSettings],
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
        applyEffects(result.effects, getHostSideEffects(interactiveSession));
      }
    },
    [addEntry, applyEffects, interactiveSession],
  );

  const applyQueuedCommandState = useCallback(
    (sideEffects: ISideEffects): boolean => {
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
      return applyEffects(queued.effects, sideEffects);
    },
    [applyEffects, commandEffectQueue],
  );

  const handleSubmit = useCallback(
    async (input: string): Promise<void> => {
      await baseHandleSubmit(input);

      const sideEffects = getHostSideEffects(interactiveSession);
      if (applyQueuedCommandState(sideEffects)) return;

      if (sideEffects._pendingModelId) {
        const modelId = sideEffects._pendingModelId as string;
        delete sideEffects._pendingModelId;
        pendingModelChangeRef.current = modelId;
        setPendingModelId(modelId);
        return;
      }

      if (sideEffects._resetRequested) {
        delete sideEffects._resetRequested;
        applyEffects([{ type: 'settings-reset-requested' }], sideEffects);
        return;
      }

      if (sideEffects._exitRequested) {
        delete sideEffects._exitRequested;
        applyEffects([{ type: 'session-exit-requested' }], sideEffects);
        return;
      }

      if (sideEffects._triggerResumePicker) {
        delete sideEffects._triggerResumePicker;
        applyEffects([{ type: 'session-picker-requested' }], sideEffects);
        return;
      }

      if (sideEffects._sessionName) {
        const name = sideEffects._sessionName as string;
        delete sideEffects._sessionName;
        applyEffects([{ type: 'session-renamed', name }], sideEffects);
        return;
      }

      if (applyPendingStatusLinePatch(sideEffects, setStatusLineSettings)) return;
    },
    [
      interactiveSession,
      baseHandleSubmit,
      applyQueuedCommandState,
      applyEffects,
      setStatusLineSettings,
    ],
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
        });
      } else {
        addModelChangeCancelledMessage(addEntry);
      }
    },
    [cwd, providerOverride, addEntry, requestShutdown],
  );

  const handleInteractionSubmit = useCallback(
    async (value: string): Promise<void> => {
      const interaction = commandInteractionRef.current;
      if (interaction === null) {
        setPendingInteractionPrompt(null);
        return;
      }
      try {
        const result = await interaction.submit(value);
        applyCommandResult(result);
      } catch (err) {
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
    setPendingModelId,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
    handleInteractionSubmit,
    handleInteractionCancel,
  };
}

function getHostSideEffects(interactiveSession: InteractiveSession): ISideEffects {
  return interactiveSession as unknown as ISideEffects;
}
