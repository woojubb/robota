/**
 * Standard Robota storage paths.
 *
 * All CLI runtime data lives under .robota/ (project) or ~/.robota/ (user).
 * .agents/ is read-only from CLI's perspective (owned by AGENTS.md standard).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** User-level ~/.robota/ paths. */
export function userPaths(): {
  settings: string;
  sessions: string;
  onboarded: string;
} {
  const base = join(homedir(), '.robota');
  return {
    settings: join(base, 'settings.json'),
    sessions: join(base, 'sessions'),
    onboarded: join(base, 'onboarded'),
  };
}
