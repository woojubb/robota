import { useState } from 'react';
import { getUserSettingsPath, readSettings } from '../../utils/settings-io.js';
import {
  readStatusLineSettings,
  type IStatusLineSettings,
} from '../../utils/statusline-settings.js';

export function useStatusLineSettings(): [
  IStatusLineSettings,
  (settings: IStatusLineSettings) => void,
] {
  return useState<IStatusLineSettings>(() =>
    readStatusLineSettings(readSettings(getUserSettingsPath())),
  );
}
