import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { listResumableSessions, lockedSessionsNotice } from '@robota-sdk/agent-framework';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useUnlockCommand } from '../tui-cli-adapter-context.js';
import { linkedPickerDecisions, localPickerDecisions, plainHostedPickerDecisions } from '../session-picker-decisions.js';
import { usePluginCallbacks } from './usePluginCallbacks.js';
import { useSessionSelection } from './useSessionSelection.js';

import type {
  IAppPluginViewModel,
  IAppSessionPickerViewModel,
  IAppTransportViewModel,
} from '../app-view-model.js';
import type { TSessionSwitch } from '../types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { ICommandPluginAdapter } from '@robota-sdk/agent-interface-command';
import type {
  IInteractiveSessionStore,
  ISessionListingEntry,
  IOwnerSessionDirectory,
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
  readonly ownerSessions?: IOwnerSessionDirectory | undefined;
  readonly onOwnerInvalidated?: ((listener: () => void) => () => void) | undefined;
  /** The host's sessions, when the channel's host keeps them; they replace the local store's. */
  readonly hostSessions: readonly ISessionListingEntry[] | undefined;
  /** The sealed sessions the host left out of `hostSessions`, for whatever reason it cannot open them. */
  readonly hostLockedSessionCount: number;
  readonly sessionPickerVisible: boolean;
  readonly setSessionPickerVisible: (visible: boolean) => void;
  readonly onSessionSwitch: TSessionSwitch;
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
  // The store is read once each time the picker opens, not on every render of the app: a listing
  // decodes every saved session, and the app re-renders on every keystroke and streamed token.
  const unlockCommand = useUnlockCommand();
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
      sealedNotice: lockedSessionsNotice(local.locked, local.noKeys, unlockCommand),
    };
  }, [
    unlockCommand,
    options.sessionPickerVisible,
    options.hostSessions,
    options.hostLockedSessionCount,
    options.sessionStore,
    options.cwd,
  ]);
  const sessions: readonly ISessionListingEntry[] = listing?.sessions ?? NO_SESSIONS;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const switchRef = useRef(options.onSessionSwitch);
  switchRef.current = options.onSessionSwitch;
  const hostListing = options.hostSessions !== undefined;
  // Identity changes only when the store or linked authority changes; normal listing updates keep
  // the current question alive while the adapter reads the latest rows and switch callback.
  const decisions = useMemo(() => {
    if (hostListing) return options.ownerSessions === undefined
      ? plainHostedPickerDecisions()
      : linkedPickerDecisions(options.ownerSessions);
    return localPickerDecisions(options.sessionStore, () => sessionsRef.current,
      (id, switchOptions) => switchRef.current(id, switchOptions));
  }, [hostListing, options.ownerSessions, options.sessionStore]);
  const selection = useSessionSelection({
    ownerSessions: decisions,
    onOwnerInvalidated: options.onOwnerInvalidated,
    pickerVisible: options.sessionPickerVisible,
    setPickerVisible: options.setSessionPickerVisible,
    onSessionSwitch: options.onSessionSwitch,
    addEntry: options.addEntry,
  });
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
      pickerKey: selection.pickerKey,
      select: selection.select,
      cancel: selection.cancel,
      pendingAcceptance: selection.pendingAcceptance,
    },
  };
}
