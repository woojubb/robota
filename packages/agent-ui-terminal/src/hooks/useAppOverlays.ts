import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { listResumableSessionSummaries } from '@robota-sdk/agent-framework';
import { useCallback, useEffect } from 'react';

import { usePluginCallbacks } from './usePluginCallbacks.js';

import type {
  IAppPluginViewModel,
  IAppSessionPickerViewModel,
  IAppTransportViewModel,
} from '../app-view-model.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type {
  IInteractiveSessionStore,
  ISessionListingEntry,
} from '@robota-sdk/agent-interface-session';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

interface IOptions {
  readonly cwd: string;
  readonly pluginAdapter: ICommandPluginAdapter | undefined;
  readonly pluginVisible: boolean;
  readonly setPluginVisible: (visible: boolean) => void;
  readonly transportRegistry: ITransportRegistryView | undefined;
  readonly transportVisible: boolean;
  readonly setTransportVisible: (visible: boolean) => void;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  /** The host's sessions, when the channel's host keeps them; they replace the local store's. */
  readonly hostSessions: readonly ISessionListingEntry[] | undefined;
  readonly sessionPickerVisible: boolean;
  readonly setSessionPickerVisible: (visible: boolean) => void;
  readonly onSessionSwitch: (sessionId: string) => Promise<void>;
  readonly addEntry: (entry: IHistoryEntry) => void;
}

const NO_SESSIONS_NOTICE = 'No saved sessions to resume in this workspace.';

export interface IAppOverlays {
  readonly plugin: IAppPluginViewModel;
  readonly transport: IAppTransportViewModel;
  readonly sessionPicker: IAppSessionPickerViewModel;
}

export function useAppOverlays(options: IOptions): IAppOverlays {
  const pluginCallbacks = usePluginCallbacks(options.pluginAdapter);
  const addPluginMessage = useCallback(
    (content: string) => options.addEntry(messageToHistoryEntry(createSystemMessage(content))),
    [options.addEntry],
  );
  const selectSession = useCallback(
    (sessionId: string) => {
      options.setSessionPickerVisible(false);
      void options.onSessionSwitch(sessionId);
    },
    [options.onSessionSwitch, options.setSessionPickerVisible],
  );
  const cancelSessionPicker = useCallback(() => {
    options.setSessionPickerVisible(false);
    options.addEntry(messageToHistoryEntry(createSystemMessage('Session resume cancelled.')));
  }, [options.addEntry, options.setSessionPickerVisible]);
  const sessions =
    options.hostSessions ?? listResumableSessionSummaries(options.sessionStore, options.cwd);
  // A picker with nothing to pick would only hold the prompt: say so and give the prompt back.
  const nothingToResume = options.sessionPickerVisible && sessions.length === 0;
  useEffect(() => {
    if (!nothingToResume) return;
    options.setSessionPickerVisible(false);
    options.addEntry(messageToHistoryEntry(createSystemMessage(NO_SESSIONS_NOTICE)));
  }, [nothingToResume, options.addEntry, options.setSessionPickerVisible]);
  return {
    plugin: {
      visible: options.pluginVisible,
      callbacks: pluginCallbacks,
      close: () => options.setPluginVisible(false),
      addMessage: addPluginMessage,
    },
    transport: {
      visible: options.transportVisible,
      registry: options.transportRegistry,
      close: () => options.setTransportVisible(false),
    },
    sessionPicker: {
      visible: options.sessionPickerVisible && !nothingToResume,
      sessions,
      select: selectSession,
      cancel: cancelSessionPicker,
    },
  };
}
