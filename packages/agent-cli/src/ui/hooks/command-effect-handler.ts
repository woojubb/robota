import type { TCommandEffect, TStatusLineCommandSettingsPatch } from '@robota-sdk/agent-sdk';
import { isStatusLineCommandSettingsPatch } from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { IHistoryEntry, TSessionEndReason } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  deleteSettings,
  readSettings,
  writeSettings,
} from '../../utils/settings-io.js';

export interface ICommandEffectHandlerDeps {
  addEntry: (entry: IHistoryEntry) => void;
  requestShutdown: (reason: TSessionEndReason, message: string) => void;
  requestModelChange: (modelId: string) => void;
  openPluginTUI: () => void;
  openSessionPicker: () => void;
  openTransportTUI: () => void;
  renameSession: (name: string) => void;
  applyStatusLinePatch: (patch: TStatusLineCommandSettingsPatch) => boolean;
}

export function applyCommandEffects(
  effects: readonly TCommandEffect[],
  deps: ICommandEffectHandlerDeps,
): boolean {
  for (const effect of effects) {
    if (effect.type === 'model-change-requested') {
      deps.requestModelChange(effect.modelId);
      return true;
    }
    if (effect.type === 'language-change-requested') {
      applyLanguageEffect(effect.language, deps);
      return true;
    }
    if (effect.type === 'settings-reset-requested') {
      applySettingsResetEffect(deps);
      return true;
    }
    if (effect.type === 'session-exit-requested') {
      deps.requestShutdown(
        effect.reason ?? 'prompt_input_exit',
        effect.message ?? 'User requested exit',
      );
      return true;
    }
    if (effect.type === 'session-restart-requested') {
      deps.requestShutdown(effect.reason, effect.message);
      return true;
    }
    if (effect.type === 'plugin-tui-requested') {
      deps.openPluginTUI();
      return true;
    }
    if (effect.type === 'settings-tui-requested') {
      deps.openTransportTUI();
      return true;
    }
    if (effect.type === 'session-picker-requested') {
      deps.openSessionPicker();
      return true;
    }
    if (effect.type === 'session-renamed') {
      deps.renameSession(effect.name);
      return true;
    }
    if (effect.type === 'statusline-settings-patch') {
      if (isStatusLineCommandSettingsPatch(effect.patch)) {
        return deps.applyStatusLinePatch(effect.patch);
      }
    }
  }
  return false;
}

function applyLanguageEffect(language: string, deps: ICommandEffectHandlerDeps): void {
  const settingsPath = getUserSettingsPath();
  const settings = readSettings(settingsPath);
  settings.language = language;
  writeSettings(settingsPath, settings);
  deps.addEntry(
    messageToHistoryEntry(createSystemMessage(`Language set to "${language}". Restarting...`)),
  );
  deps.requestShutdown('other', 'Language change restart');
}

function applySettingsResetEffect(deps: ICommandEffectHandlerDeps): void {
  const settingsPath = getUserSettingsPath();
  if (deleteSettings(settingsPath)) {
    deps.addEntry(
      messageToHistoryEntry(createSystemMessage(`Deleted ${settingsPath}. Exiting...`)),
    );
  } else {
    deps.addEntry(messageToHistoryEntry(createSystemMessage('No user settings found.')));
  }
  deps.requestShutdown('other', 'Reset settings restart');
}
