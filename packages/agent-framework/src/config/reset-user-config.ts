import { deleteSettings } from './settings-io.js';

export interface IResetUserConfigResult {
  deleted: boolean;
  path: string;
}

export function resetUserConfig(path: string): IResetUserConfigResult {
  const deleted = deleteSettings(path);
  return { deleted, path };
}
