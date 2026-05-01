/**
 * Hook for handling TUI-specific side effects from system commands.
 * Extracted from App.tsx for single-responsibility.
 */

import { useState, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry, getModelName } from '@robota-sdk/agent-core';
import type { IHistoryEntry, TSessionEndReason } from '@robota-sdk/agent-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  updateModelInSettings,
  deleteSettings,
  readSettings,
  writeSettings,
} from '../../utils/settings-io.js';
import {
  applyProviderConfiguration,
  applyProviderSwitch,
} from '../../utils/provider-configuration.js';
import { readMergedProviderSettings } from '../../utils/provider-factory.js';
import type { IProviderSetupInput } from '../../utils/provider-settings.js';
import type { TProviderSetupType } from '../../utils/provider-setup-flow.js';
import type { ISideEffects } from './useInteractiveSession.js';

const EXIT_DELAY_MS = 500;

interface IUseSideEffectsOptions {
  cwd: string;
  interactiveSession: InteractiveSession;
  addEntry: (entry: IHistoryEntry) => void;
  baseHandleSubmit: (input: string) => Promise<void>;
  setSessionName: (name: string) => void;
  providerDefinitions: readonly IProviderDefinition[];
}

interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  pendingModelId: string | null;
  pendingProviderProfile: string | null;
  pendingProviderSetupType: TProviderSetupType | null;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  setPendingModelId: (id: string | null) => void;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  handleModelConfirm: (index: number) => void;
  handleProviderConfirm: (index: number) => void;
  handleProviderSetupSubmit: (input: IProviderSetupInput) => void;
  handleProviderSetupCancel: () => void;
}

export function useSideEffects({
  cwd,
  interactiveSession,
  addEntry,
  baseHandleSubmit,
  setSessionName,
  providerDefinitions,
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const { exit } = useApp();
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingProviderProfile, setPendingProviderProfile] = useState<string | null>(null);
  const pendingProviderProfileRef = useRef<string | null>(null);
  const [pendingProviderSetupType, setPendingProviderSetupType] =
    useState<TProviderSetupType | null>(null);
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

      if (sideEffects._pendingProviderSetupType) {
        const type = sideEffects._pendingProviderSetupType;
        delete sideEffects._pendingProviderSetupType;
        setPendingProviderSetupType(type);
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
    },
    [interactiveSession, baseHandleSubmit, addEntry, requestShutdown, setSessionName],
  );

  const handleModelConfirm = useCallback(
    (index: number) => {
      const modelId = pendingModelChangeRef.current;
      setPendingModelId(null);
      pendingModelChangeRef.current = null;
      if (index === 0 && modelId) {
        try {
          const settingsPath = getUserSettingsPath();
          updateModelInSettings(settingsPath, modelId);
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
    [addEntry, requestShutdown],
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

  const handleProviderSetupSubmit = useCallback(
    (input: IProviderSetupInput) => {
      setPendingProviderSetupType(null);
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

  const handleProviderSetupCancel = useCallback(() => {
    setPendingProviderSetupType(null);
    addEntry(messageToHistoryEntry(createSystemMessage('Provider setup cancelled.')));
  }, [addEntry]);

  return {
    handleSubmit,
    pendingModelId,
    pendingProviderProfile,
    pendingProviderSetupType,
    showPluginTUI,
    showSessionPicker,
    setPendingModelId,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
    handleProviderConfirm,
    handleProviderSetupSubmit,
    handleProviderSetupCancel,
  };
}
