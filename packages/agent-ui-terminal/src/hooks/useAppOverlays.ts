import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { listResumableSessions, lockedSessionsNotice } from '@robota-sdk/agent-framework';
import { useCallback, useEffect, useMemo, useRef } from 'react';

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
  /** The sealed sessions the host left out of `hostSessions`, for whatever reason it cannot open them. */
  readonly hostLockedSessionCount: number;
  readonly sessionPickerVisible: boolean;
  readonly setSessionPickerVisible: (visible: boolean) => void;
  readonly onSessionSwitch: (sessionId: string) => Promise<void>;
  readonly addEntry: (entry: IHistoryEntry) => void;
}

const NO_SESSIONS_NOTICE = 'No saved sessions to resume in this workspace.';
const NO_SESSIONS: readonly ISessionListingEntry[] = [];

/**
 * The note for the sealed sessions a host left out. Its count holds those its keys do not open as
 * well as those an unlock would, and which is which does not cross the wire, so it never says to
 * unlock. Same wording as the web session list's.
 */
function hostSealedSessionsNotice(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1
    ? '1 saved session is sealed and not listed here.'
    : `${count} saved sessions are sealed and not listed here.`;
}

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
  // The store is read once each time the picker opens, not on every render of the app: a listing
  // decodes every saved session, and the app re-renders on every keystroke and streamed token.
  const listing = useMemo(() => {
    if (!options.sessionPickerVisible) return undefined;
    if (options.hostSessions !== undefined) {
      return {
        sessions: options.hostSessions,
        sealedNotice: hostSealedSessionsNotice(options.hostLockedSessionCount),
      };
    }
    const local = listResumableSessions(options.sessionStore, options.cwd);
    return {
      sessions: local.sessions,
      sealedNotice: lockedSessionsNotice(local.locked, local.noKeys),
    };
  }, [
    options.sessionPickerVisible,
    options.hostSessions,
    options.hostLockedSessionCount,
    options.sessionStore,
    options.cwd,
  ]);
  const sessions: readonly ISessionListingEntry[] = listing?.sessions ?? NO_SESSIONS;
  // A picker with nothing to pick would only hold the prompt: say so and give the prompt back.
  const nothingToResume = options.sessionPickerVisible && sessions.length === 0;
  const announced = useRef<typeof listing>(undefined);
  useEffect(() => {
    if (listing === undefined || announced.current === listing) return;
    announced.current = listing;
    // Sealed sessions this process cannot open are not in the picker, so the session a person wants
    // may be one of them, and an empty picker would read as "nothing saved". Say they are there.
    const notice = listing.sealedNotice;
    if (listing.sessions.length === 0) {
      options.setSessionPickerVisible(false);
      const said = notice === undefined ? NO_SESSIONS_NOTICE : `${NO_SESSIONS_NOTICE} ${notice}`;
      options.addEntry(messageToHistoryEntry(createSystemMessage(said)));
    } else if (notice !== undefined) {
      options.addEntry(messageToHistoryEntry(createSystemMessage(notice)));
    }
  }, [listing, options.addEntry, options.setSessionPickerVisible]);
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
