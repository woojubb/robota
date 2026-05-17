import { join } from 'node:path';

function getUserHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '/';
}

export function getProviderSettingsPaths(cwd: string): string[] {
  const userHome = getUserHome();
  return [
    join(userHome, '.robota', 'settings.json'),
    join(userHome, '.claude', 'settings.json'),
    join(cwd, '.robota', 'settings.json'),
    join(cwd, '.robota', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
}
