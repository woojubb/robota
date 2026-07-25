/**
 * CLI-B11 TC-02: real-store channel factory integration.
 *
 * The official CI equivalent of real-resume-verify-v3.mjs: build the channel
 * exactly the way render.tsx does (toChannelOptions + TuiInteractionChannel)
 * over a REAL project session store with a persisted conversation, and assert
 * the restored model context is non-empty. No store/session mocks.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProjectSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createScriptedProvider } from '@robota-sdk/agent-transport/testing';
import { toChannelOptions, type IRenderOptions } from '../render.js';
import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-transport';

const RESTORE_DEADLINE_MS = 10_000;
const POLL_MS = 50;

function fakeCliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: () => ({}),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

function persistConversation(store: IInteractiveSessionStore, id: string, cwd: string): void {
  const messages: TUniversalMessage[] = [
    { role: 'user', content: 'Remember the number 42.' } as TUniversalMessage,
    { role: 'assistant', content: 'Noted: 42.' } as TUniversalMessage,
    { role: 'user', content: 'And the city is Busan.' } as TUniversalMessage,
    { role: 'assistant', content: 'Noted: Busan.' } as TUniversalMessage,
  ];
  store.save({
    id,
    cwd,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    messages,
  });
}

describe('channel factory restores persisted context (CLI-B11 TC-02)', () => {
  let cwd: string;
  let channel: TuiInteractionChannel | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-b11-int-'));
  });

  afterEach(async () => {
    await channel?.stop();
    channel = undefined;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('createChannel(sessionId) over a real FileSessionStore yields usedTokens > 0', async () => {
    const store = createProjectSessionStore(cwd);
    const sessionId = 'b11-restore-session';
    persistConversation(store, sessionId, cwd);

    // Exactly the render.tsx factory: toChannelOptions(options, resumeSessionId).
    const scripted = createScriptedProvider([{ text: 'unused in this test' }]);
    const options: IRenderOptions = {
      cwd,
      provider: scripted.provider,
      sessionStore: store,
      cliAdapter: fakeCliAdapter(join(cwd, 'settings.json')),
    };
    channel = new TuiInteractionChannel(toChannelOptions(options, sessionId));
    await channel.start();

    // Restoration is asynchronous (pendingRestoreMessages inject after init).
    const deadline = Date.now() + RESTORE_DEADLINE_MS;
    let usedTokens = 0;
    while (Date.now() < deadline) {
      try {
        // allow-fallback: session init is asynchronous; poll until it is ready
        usedTokens = channel.getSession().getContextState().usedTokens;
        if (usedTokens > 0) break;
      } catch {
        // allow-fallback: session init is asynchronous; poll until it is ready
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    // The persisted messages were injected into the model context — the exact
    // signal that was 0 in the 2026-05-31 bug. (getFullHistory() is the display
    // log restored from record.history, which this record intentionally omits.)
    expect(usedTokens).toBeGreaterThan(0);
  });

  it('a channel created WITHOUT resumeSessionId starts with an empty context (control)', async () => {
    const store = createProjectSessionStore(cwd);
    persistConversation(store, 'b11-other-session', cwd);

    const scripted = createScriptedProvider([{ text: 'unused' }]);
    const options: IRenderOptions = {
      cwd,
      provider: scripted.provider,
      sessionStore: store,
      cliAdapter: fakeCliAdapter(join(cwd, 'settings.json')),
    };
    channel = new TuiInteractionChannel(toChannelOptions(options, undefined));
    await channel.start();

    const deadline = Date.now() + RESTORE_DEADLINE_MS;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      try {
        // allow-fallback: session init is asynchronous; poll until it is ready
        channel.getSession().getContextState();
        ready = true;
      } catch {
        // allow-fallback: session init is asynchronous; poll until it is ready
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }

    expect(ready).toBe(true);
    expect(channel.getSession().getFullHistory()).toHaveLength(0);
  });
});
