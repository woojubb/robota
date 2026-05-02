import { useState, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry, getModelName } from '@robota-sdk/agent-core';
import type { TSessionEndReason } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  deleteSettings,
  readSettings,
  writeSettings,
} from '../../utils/settings-io.js';
import {
  applyActiveModelChange,
  applyProviderConfiguration,
  applyProviderSwitch,
} from '../../utils/provider-configuration.js';
import { readMergedProviderSettings } from '../../utils/provider-factory.js';
import {
  startProviderSetupInteraction,
  submitProviderSetupInteractionValue,
  type TProviderSetupInteractionState,
} from '../../utils/provider-setup-interaction.js';
import type { IProviderSetupInput } from '../../utils/provider-settings.js';
import type { TInteractivePrompt } from '../../utils/interactive-prompt.js';
import type {
  ISideEffects,
  IUseSideEffectsOptions,
  IUseSideEffectsResult,
} from './side-effects-types.js';
import { applyPendingStatusLinePatch } from './statusline-side-effect.js';

const EXIT_DELAY_MS = 500;

export function useSideEffects({
  cwd,
  interactiveSession,
  addEntry,
  baseHandleSubmit,
  setSessionName,
  setStatusLineSettings,
  providerDefinitions,
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const { exit } = useApp();
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingProviderProfile, setPendingProviderProfile] = useState<string | null>(null);
  const pendingProviderProfileRef = useRef<string | null>(null);
  const [pendingInteractionPrompt, setPendingInteractionPrompt] =
    useState<TInteractivePrompt | null>(null);
  const providerSetupInteractionRef = useRef<TProviderSetupInteractionState | null>(null);
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);

  const requestShutdown = useCallback(
    (reason: TSessionEndReason, message: string): void => {
      addEntry(messageToHistoryEntry(createSystemMessage('Shutting down...')));
      setTimeout(() => {
        void interactiveSession.shutdown({ reason, message }).finally(() => exit());
      }, EXIT_DELAY_MS);
    },
    [interactiveSession, addEntry, exit],
  );

  const handleSubmit = useCallback(
    async (input: string): Promise<void> => {
      await baseHandleSubmit(input);

      const sideEffects = interactiveSession as InteractiveSession & ISideEffects;

      if (sideEffects._pendingModelId) {
        const modelId = sideEffects._pendingModelId as string;
        delete sideEffects._pendingModelId;
        pendingModelChangeRef.current = modelId;
        setPendingModelId(modelId);
        return;
      }

      if (sideEffects._pendingLanguage) {
        const lang = sideEffects._pendingLanguage as string;
        delete sideEffects._pendingLanguage;
        const settingsPath = getUserSettingsPath();
        const settings = readSettings(settingsPath);
        settings.language = lang;
        writeSettings(settingsPath, settings);
        addEntry(
          messageToHistoryEntry(createSystemMessage(`Language set to "${lang}". Restarting...`)),
        );
        requestShutdown('other', 'Language change restart');
        return;
      }

      if (sideEffects._pendingProviderProfile) {
        const profile = sideEffects._pendingProviderProfile as string;
        delete sideEffects._pendingProviderProfile;
        pendingProviderProfileRef.current = profile;
        setPendingProviderProfile(profile);
        return;
      }

      if (sideEffects._pendingProviderSetup !== undefined) {
        const setup = sideEffects._pendingProviderSetup;
        delete sideEffects._pendingProviderSetup;
        const result = startProviderSetupInteraction(providerDefinitions, setup.type);
        if (result.status === 'prompt') {
          providerSetupInteractionRef.current = result.state;
          setPendingInteractionPrompt(result.prompt);
        }
        return;
      }

      if (sideEffects._resetRequested) {
        delete sideEffects._resetRequested;
        const settingsPath = getUserSettingsPath();
        if (deleteSettings(settingsPath)) {
          addEntry(
            messageToHistoryEntry(createSystemMessage(`Deleted ${settingsPath}. Exiting...`)),
          );
        } else {
          addEntry(messageToHistoryEntry(createSystemMessage('No user settings found.')));
        }
        requestShutdown('other', 'Reset settings restart');
        return;
      }

      if (sideEffects._exitRequested) {
        delete sideEffects._exitRequested;
        requestShutdown('prompt_input_exit', 'User requested exit');
        return;
      }

      if (sideEffects._triggerPluginTUI) {
        delete sideEffects._triggerPluginTUI;
        setShowPluginTUI(true);
        return;
      }

      if (sideEffects._triggerResumePicker) {
        delete sideEffects._triggerResumePicker;
        setShowSessionPicker(true);
        return;
      }

      if (sideEffects._sessionName) {
        const name = sideEffects._sessionName as string;
        delete sideEffects._sessionName;
        interactiveSession.setName(name);
        setSessionName(name);
        return;
      }

      if (applyPendingStatusLinePatch(sideEffects, setStatusLineSettings)) return;
    },
    [
      interactiveSession,
      baseHandleSubmit,
      addEntry,
      requestShutdown,
      setSessionName,
      setStatusLineSettings,
      providerDefinitions,
    ],
  );

  const handleModelConfirm = useCallback(
    (index: number) => {
      const modelId = pendingModelChangeRef.current;
      setPendingModelId(null);
      pendingModelChangeRef.current = null;
      if (index === 0 && modelId) {
        try {
          applyActiveModelChange(cwd, modelId);
          addEntry(
            messageToHistoryEntry(
              createSystemMessage(`Model changed to ${getModelName(modelId)}. Restarting...`),
            ),
          );
          requestShutdown('other', 'Model change restart');
        } catch (err) {
          addEntry(
            messageToHistoryEntry(
              createSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`),
            ),
          );
        }
      } else {
        addEntry(messageToHistoryEntry(createSystemMessage('Model change cancelled.')));
      }
    },
    [cwd, addEntry, requestShutdown],
  );

  const handleProviderConfirm = useCallback(
    (index: number) => {
      const profile = pendingProviderProfileRef.current;
      setPendingProviderProfile(null);
      pendingProviderProfileRef.current = null;
      if (index === 0 && profile) {
        try {
          const settingsPath = getUserSettingsPath();
          applyProviderSwitch(settingsPath, profile, {
            knownProviders: readMergedProviderSettings(cwd).providers,
          });
          addEntry(
            messageToHistoryEntry(
              createSystemMessage(`Provider changed to ${profile}. Restarting...`),
            ),
          );
          requestShutdown('other', 'Provider change restart');
        } catch (err) {
          addEntry(
            messageToHistoryEntry(
              createSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`),
            ),
          );
        }
      } else {
        addEntry(messageToHistoryEntry(createSystemMessage('Provider change cancelled.')));
      }
    },
    [cwd, addEntry, requestShutdown],
  );

  const completeProviderSetup = useCallback(
    (input: IProviderSetupInput): void => {
      providerSetupInteractionRef.current = null;
      setPendingInteractionPrompt(null);
      try {
        const settingsPath = getUserSettingsPath();
        applyProviderConfiguration(settingsPath, input, { providerDefinitions });
        addEntry(
          messageToHistoryEntry(
            createSystemMessage(`Provider ${input.profile} configured. Restarting...`),
          ),
        );
        requestShutdown('other', 'Provider setup restart');
      } catch (err) {
        addEntry(
          messageToHistoryEntry(
            createSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
        );
      }
    },
    [addEntry, requestShutdown, providerDefinitions],
  );

  const handleInteractionSubmit = useCallback(
    (value: string) => {
      const state = providerSetupInteractionRef.current;
      if (state === null) {
        setPendingInteractionPrompt(null);
        return;
      }
      try {
        const result = submitProviderSetupInteractionValue(state, value);
        if (result.status === 'complete') {
          completeProviderSetup(result.input);
          return;
        }
        providerSetupInteractionRef.current = result.state;
        setPendingInteractionPrompt(result.prompt);
      } catch (err) {
        providerSetupInteractionRef.current = null;
        setPendingInteractionPrompt(null);
        addEntry(
          messageToHistoryEntry(
            createSystemMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`),
          ),
        );
      }
    },
    [addEntry, completeProviderSetup],
  );

  const handleInteractionCancel = useCallback(() => {
    providerSetupInteractionRef.current = null;
    setPendingInteractionPrompt(null);
    addEntry(messageToHistoryEntry(createSystemMessage('Provider setup cancelled.')));
  }, [addEntry]);

  return {
    handleSubmit,
    pendingModelId,
    pendingProviderProfile,
    pendingInteractionPrompt,
    showPluginTUI,
    showSessionPicker,
    setPendingModelId,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
    handleProviderConfirm,
    handleInteractionSubmit,
    handleInteractionCancel,
  };
}
