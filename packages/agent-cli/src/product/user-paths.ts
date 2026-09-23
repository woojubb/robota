import { homedir } from 'node:os';
import { join } from 'node:path';

/** Robota's user-owned runtime storage layout. */
export function userPaths(home: string = homedir()): {
  settings: string;
  sessions: string;
  onboarded: string;
  history: string;
  workspaceTrust: string;
  orgPolicy: string;
} {
  const base = join(home, '.robota');
  return {
    settings: join(base, 'settings.json'),
    sessions: join(base, 'sessions'),
    onboarded: join(base, 'onboarded'),
    history: join(base, 'history.jsonl'),
    workspaceTrust: join(base, 'workspace-trust.json'),
    orgPolicy: join(base, 'org-policy.json'),
  };
}
