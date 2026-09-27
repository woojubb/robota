import { useCallback, useRef, useState } from 'react';

import type { IWsSessionState } from './session-client-types.js';
import type { TClientMessage } from '../client/ws-session-client.js';
import type { ISettingsSnapshot, TSettingsPatch } from '@robota-sdk/agent-interface-session';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TSettingsState = Pick<
  IWsSessionState,
  | 'settingsOpen'
  | 'settingsStatus'
  | 'settingsSnapshot'
  | 'settingsError'
  | 'settingsInitialSectionId'
  | 'openSettings'
  | 'closeSettings'
  | 'updateSettings'
>;

let requestCounter = 0;
function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}_${requestCounter}_${Date.now()}`;
}

/**
 * #3282 §4a: the Settings screen's own correlated request/response state, independent from chat
 * state — the same shape `usePersonalUsageState` already uses for `get-personal-usage-report`.
 *
 * `openSettings` re-fetches every time (opening from the gear, `/settings`, or reopening after a
 * close): the simplest correct way for a change made elsewhere — another typed command, another
 * client — to reach an open-then-reopened screen, per #3282 §4's "pick the simplest correct option."
 *
 * A failed UPDATE never touches `settingsSnapshot`, so a control bound to it shows the value it had
 * before the write — "a failed write leaves the control at its previous value" — while
 * `settingsError` carries the plain message to show beside it. A failed INITIAL load (no snapshot to
 * fall back to) is the one case that flips `settingsStatus` to `'error'`.
 */
export function useSettingsState(send: (msg: TClientMessage) => void): TSettingsState & {
  handleSettingsMessage: (msg: TServerMessage) => boolean;
} {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<IWsSessionState['settingsStatus']>('idle');
  const [settingsSnapshot, setSettingsSnapshot] = useState<ISettingsSnapshot | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // #3282 §4 part b-2: which section to land on THIS open — `/plugin` opens straight to Plugins,
  // everything else (the gear, `/settings`) opens on the screen's own default (General).
  const [settingsInitialSectionId, setSettingsInitialSectionId] = useState<string | null>(null);
  const requestRef = useRef<string | null>(null);

  const handleSettingsMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type !== 'settings' && msg.type !== 'settings_error') return false;
    if (requestRef.current !== msg.requestId) return true; // superseded by a later request
    if (msg.type === 'settings') {
      setSettingsSnapshot(msg.settings);
      setSettingsStatus('ready');
      setSettingsError(null);
      return true;
    }
    setSettingsError(msg.message);
    setSettingsStatus((current) => (current === 'ready' ? 'ready' : 'error'));
    return true;
  }, []);

  const openSettings = useCallback(
    (sectionId?: string): void => {
      setSettingsOpen(true);
      setSettingsInitialSectionId(sectionId ?? null);
      setSettingsStatus((current) => (current === 'ready' ? 'ready' : 'loading'));
      setSettingsError(null);
      const requestId = nextRequestId('get_settings');
      requestRef.current = requestId;
      send({ type: 'get-settings', requestId });
    },
    [send],
  );

  const closeSettings = useCallback((): void => {
    setSettingsOpen(false);
  }, []);

  const updateSettings = useCallback(
    (patch: TSettingsPatch): void => {
      const requestId = nextRequestId('update_settings');
      requestRef.current = requestId;
      setSettingsError(null);
      send({ type: 'update-settings', requestId, patch });
    },
    [send],
  );

  return {
    settingsOpen,
    settingsStatus,
    settingsSnapshot,
    settingsError,
    settingsInitialSectionId,
    openSettings,
    closeSettings,
    updateSettings,
    handleSettingsMessage,
  };
}
