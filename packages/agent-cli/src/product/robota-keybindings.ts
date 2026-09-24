import { join } from 'node:path';

export const ROBOTA_KEYBINDINGS_SCHEMA_URL =
  'https://docs.robota.io/schemas/keybindings.schema.json';

export function createRobotaKeybindingsOptions(homeDir: string) {
  return {
    filePath: join(homeDir, '.robota', 'keybindings.json'),
    schemaUrl: ROBOTA_KEYBINDINGS_SCHEMA_URL,
  } as const;
}
