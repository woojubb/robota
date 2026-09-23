import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { userPaths } from '../user-paths.js';

describe('Robota user paths', () => {
  it('keeps every user-owned runtime path under the selected home', () => {
    const first = userPaths('/first-home');
    const second = userPaths('/second-home');

    expect(first).toEqual({
      settings: join('/first-home', '.robota', 'settings.json'),
      sessions: join('/first-home', '.robota', 'sessions'),
      onboarded: join('/first-home', '.robota', 'onboarded'),
      history: join('/first-home', '.robota', 'history.jsonl'),
      workspaceTrust: join('/first-home', '.robota', 'workspace-trust.json'),
      orgPolicy: join('/first-home', '.robota', 'org-policy.json'),
    });
    expect(second.sessions).toBe(join('/second-home', '.robota', 'sessions'));
  });
});
