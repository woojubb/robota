/**
 * A session reports the composition of the system message it holds now — never the previous
 * message's. The manifest is replaced together with the message, and a message set without one
 * leaves the session saying it does not know.
 */

import { describe, expect, it } from 'vitest';

import { AbstractAIProvider } from '@robota-sdk/agent-core';
import { Session } from '../session.js';

import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISystemPromptManifest } from '@robota-sdk/agent-interface/session';

class QuietProvider extends AbstractAIProvider {
  readonly name = 'quiet-provider';
  readonly version = '1.0.0';

  override async chat(): Promise<TUniversalMessage> {
    return {
      id: 'msg-1',
      role: 'assistant',
      content: 'ok',
      state: 'complete',
      timestamp: new Date(),
    };
  }
}

const TERMINAL = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: async () => '',
  select: async () => '',
  spinner: () => ({ stop: () => {}, update: () => {} }),
};

const FIRST: ISystemPromptManifest = {
  harnessVersion: 'none',
  sections: [{ id: 'runtime-cwd', source: 'runtime', characters: 4 }],
};
const SECOND: ISystemPromptManifest = {
  harnessVersion: 'sha256:0123456789ab',
  sections: [{ id: 'preset-persona', source: 'persona', characters: 7 }],
};

function session(manifest?: ISystemPromptManifest): Session {
  return new Session({
    hookTypeExecutors: [],
    cwd: process.cwd(),
    tools: [],
    provider: new QuietProvider() as never,
    systemMessage: 'test',
    ...(manifest !== undefined ? { systemPromptManifest: manifest } : {}),
    terminal: TERMINAL as never,
    model: 'base-model',
  });
}

describe('Session system prompt manifest', () => {
  it('reports the manifest it was constructed with', () => {
    expect(session(FIRST).getSystemPromptManifest()).toBe(FIRST);
  });

  it('reports none when it was constructed without one', () => {
    expect(session().getSystemPromptManifest()).toBeUndefined();
  });

  it('replaces the manifest together with the message', () => {
    const live = session(FIRST);
    live.updateSystemMessage('persona text', SECOND);
    expect(live.getSystemMessage()).toBe('persona text');
    expect(live.getSystemPromptManifest()).toBe(SECOND);
  });

  it('forgets the old manifest when the new message arrives without one', () => {
    const live = session(FIRST);
    live.updateSystemMessage('supplied whole');
    expect(live.getSystemPromptManifest()).toBeUndefined();
  });
});
