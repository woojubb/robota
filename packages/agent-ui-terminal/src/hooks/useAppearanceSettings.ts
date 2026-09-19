import { readAppearanceSettings } from '@robota-sdk/agent-framework';
import { useCallback, useState } from 'react';

import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { IAppearanceSettings } from '@robota-sdk/agent-interface-command';

function readFromAdapter(cliAdapter: ITuiCliAdapter): IAppearanceSettings {
  return readAppearanceSettings(cliAdapter.readSettings(cliAdapter.getUserSettingsPath()));
}

/**
 * SCREEN-2002 — the persisted appearance, plus a from-disk `refresh()`.
 *
 * Refresh-on-result, the shape `useStatusLineSettings` already uses: the HOST applies
 * `appearance-settings-patch` through the settings adapter, so the renderer learns about a change by
 * RE-READING the document when a command result arrives. The TUI never writes these keys itself,
 * which is what keeps one writer for one file.
 */
export function useAppearanceSettings(): [IAppearanceSettings, () => void] {
  const cliAdapter = useTuiCliAdapter();
  const [appearance, setAppearance] = useState<IAppearanceSettings>(() =>
    readFromAdapter(cliAdapter),
  );
  const refresh = useCallback((): void => {
    setAppearance(readFromAdapter(cliAdapter));
  }, [cliAdapter]);
  return [appearance, refresh];
}
