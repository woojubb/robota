import os from 'node:os';
import path from 'node:path';

const APP_DIR = 'robota-dag';

/**
 * Resolves the DAG storage root directory.
 * Precedence: env DAG_STORAGE_ROOT → XDG_DATA_HOME → ~/.robota-dag/storage
 */
export function resolveStorageRoot(): string {
  if (process.env.DAG_STORAGE_ROOT) {
    return path.resolve(process.env.DAG_STORAGE_ROOT);
  }
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) {
    return path.join(xdgData, APP_DIR, 'storage');
  }
  return path.join(os.homedir(), `.${APP_DIR}`, 'storage');
}

/**
 * Resolves the asset storage root directory.
 * Precedence: env ASSET_STORAGE_ROOT → XDG_DATA_HOME → ~/.robota-dag/assets
 */
export function resolveAssetRoot(): string {
  if (process.env.ASSET_STORAGE_ROOT) {
    return path.resolve(process.env.ASSET_STORAGE_ROOT);
  }
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) {
    return path.join(xdgData, APP_DIR, 'assets');
  }
  return path.join(os.homedir(), `.${APP_DIR}`, 'assets');
}
