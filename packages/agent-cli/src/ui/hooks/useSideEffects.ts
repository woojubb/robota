/**
 * Hook for handling TUI-specific side effects from system commands.
 * Extracted from App.tsx for single-responsibility.
 */

import { useState, useRef, useCallback } from 'react';
import { useApp } from 'ink';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry, getModelName } from '@robota-sdk/agent-core';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  updateModelInSettings,
  deleteSettings,
  readSettings,
  writeSettings,
} from '../../utils/settings-io.js';
import type { ISideEffects } from './useInteractiveSession.js';

const EXIT_DELAY_MS = 500;

interface IUseSideEffectsOptions {
  interactiveSession: InteractiveSession;
  addEntry: (entry: IHistoryEntry) => void;
  baseHandleSubmit: (input: string) => Promise<void>;
  setSessionName: (name: string) => void;
}

interface IUseSideEffectsResult {
  handleSubmit: (input: string) => Promise<void>;
  pendingModelId: string | null;
  showPluginTUI: boolean;
  showSessionPicker: boolean;
  setPendingModelId: (id: string | null) => void;
  setShowPluginTUI: (show: boolean) => void;
  setShowSessionPicker: (show: boolean) => void;
  handleModelConfirm: (index: number) => void;
}

export function useSideEffects({
  interactiveSession,
  addEntry,
  baseHandleSubmit,
  setSessionName,
}: IUseSideEffectsOptions): IUseSideEffectsResult {
  const { exit } = useApp();
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);

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
        setTimeout(() => exit(), EXIT_DELAY_MS);
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
        setTimeout(() => exit(), EXIT_DELAY_MS);
        return;
      }

      if (sideEffects._exitRequested) {
        delete sideEffects._exitRequested;
        setTimeout(() => exit(), EXIT_DELAY_MS);
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
    [interactiveSession, baseHandleSubmit, addEntry, exit, setSessionName],
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
          setTimeout(() => exit(), EXIT_DELAY_MS);
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
    [addEntry, exit],
  );

  return {
    handleSubmit,
    pendingModelId,
    showPluginTUI,
    showSessionPicker,
    setPendingModelId,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
  };
}
