import { join } from 'node:path';

/** Robota's bundle plugin location, shared by install, runtime loading, and trust preview. */
export const ROBOTA_PLUGIN_DIRECTORY = join('.robota', 'plugins');

export function robotaPluginDirectories(cwd: string, userHome: string): {
  readonly project: string;
  readonly user: string;
} {
  return {
    project: join(cwd, ROBOTA_PLUGIN_DIRECTORY),
    user: join(userHome, ROBOTA_PLUGIN_DIRECTORY),
  };
}
