/**
 * Standard Robota storage paths.
 *
 * All CLI runtime data lives under .robota/ (project) or ~/.robota/ (user).
 * .agents/ is read-only from CLI's perspective (owned by AGENTS.md standard).
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

/** Project-level .robota/ paths (relative to cwd). */
export function projectPaths(cwd: string): {
  settings: string;
  settingsLocal: string;
  logs: string;
  sessions: string;
} {
  const base = join(cwd, '.robota');
  return {
    settings: join(base, 'settings.json'),
    settingsLocal: join(base, 'settings.local.json'),
    logs: join(base, 'logs'),
    sessions: join(base, 'sessions'),
  };
}

/** User-level ~/.robota/ paths. */
export function userPaths(): {
  settings: string;
  sessions: string;
} {
  const base = join(homedir(), '.robota');
  return {
    settings: join(base, 'settings.json'),
    sessions: join(base, 'sessions'),
  };
}
