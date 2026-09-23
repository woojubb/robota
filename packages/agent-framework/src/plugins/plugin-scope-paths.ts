import { join } from 'node:path';

/** Host bundle plugin root, shared by session loading and the project inventory. */
export const PROJECT_PLUGIN_RELATIVE_DIRECTORY = join('.robota', 'plugins');

export function pluginsDirUnder(base: string): string {
  return join(base, PROJECT_PLUGIN_RELATIVE_DIRECTORY);
}
