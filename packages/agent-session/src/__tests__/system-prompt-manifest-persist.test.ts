import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { persistSession } from '../session-history-ops.js';
import { NodeSessionStore } from '../session-store.js';

import type { ISystemPromptManifest } from '@robota-sdk/agent-interface/session';

const SESSION_ID = 'sess_manifest';

const MANIFEST: ISystemPromptManifest = {
  harnessVersion: 'sha256:0123456789ab',
  sections: [
    { id: 'preset-persona', source: 'persona', characters: 12 },
    { id: 'runtime-cwd', source: 'runtime', characters: 30 },
  ],
};

function persist(
  store: NodeSessionStore,
  systemPrompt: string,
  systemPromptManifest: ISystemPromptManifest | undefined,
): void {
  persistSession({
    sessionStore: store,
    sessionId: SESSION_ID,
    cwd: '/work',
    systemPrompt,
    systemPromptManifest,
    toolSchemas: [],
    conversation: { id: SESSION_ID, cwd: '/work', messages: [] },
    getFullHistory: () => [],
  } as unknown as Parameters<typeof persistSession>[0]);
}

function loadManifest(store: NodeSessionStore): ISystemPromptManifest | undefined {
  const outcome = store.load(SESSION_ID);
  if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
  return outcome.record.systemPromptManifest;
}

describe('a saved session names the sections of the prompt it saved', () => {
  it('writes the manifest beside the prompt and reads it back', () => {
    const store = new NodeSessionStore(
      realpathSync(mkdtempSync(path.join(tmpdir(), 'manifest-'))),
      {
        sealing: 'plain',
      },
    );
    persist(store, 'prompt', MANIFEST);
    expect(loadManifest(store)).toStrictEqual(MANIFEST);
  });

  it('drops the earlier manifest when the prompt is replaced by one with no known composition', () => {
    const store = new NodeSessionStore(
      realpathSync(mkdtempSync(path.join(tmpdir(), 'manifest-'))),
      {
        sealing: 'plain',
      },
    );
    persist(store, 'prompt', MANIFEST);
    persist(store, 'a prompt supplied whole', undefined);
    // The record read before the write still carries the old manifest; keeping it would label the
    // new prompt with sections it does not have.
    expect(loadManifest(store)).toBeUndefined();
  });
});
