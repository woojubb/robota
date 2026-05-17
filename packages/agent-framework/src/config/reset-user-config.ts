import { deleteSettings, getUserSettingsPath } from './settings-io.js';

export interface IResetUserConfigResult {
  deleted: boolean;
  path: string;
}

export function resetUserConfig(): IResetUserConfigResult {
  const path = getUserSettingsPath();
  const deleted = deleteSettings(path);
  return { deleted, path };
}
