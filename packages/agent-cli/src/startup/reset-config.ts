import { deleteSettings, getUserSettingsPath } from '@robota-sdk/agent-framework';

export function resetConfig(): void {
  const userPath = getUserSettingsPath();
  if (deleteSettings(userPath)) {
    process.stdout.write(`Deleted ${userPath}\n`);
  } else {
    process.stdout.write('No user settings found.\n');
  }
}
