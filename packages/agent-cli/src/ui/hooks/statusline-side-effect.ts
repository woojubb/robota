import { getUserSettingsPath } from '../../utils/settings-io.js';
import {
  applyStatusLineSettings,
  type IStatusLineSettings,
} from '../../utils/statusline-settings.js';
import type { ISideEffects } from './side-effects-types.js';

export function applyPendingStatusLinePatch(
  sideEffects: ISideEffects,
  setStatusLineSettings: (settings: IStatusLineSettings) => void,
): boolean {
  if (!sideEffects._statusLinePatch) return false;
  const patch = sideEffects._statusLinePatch;
  delete sideEffects._statusLinePatch;
  setStatusLineSettings(applyStatusLineSettings(getUserSettingsPath(), patch));
  return true;
}
