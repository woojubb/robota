/**
 * Regression test for the "cold session" preset/model live-switch bug.
 *
 * Bug (2026-06-14): on a freshly-constructed interactive session, running `/preset` (or any live
 * model re-apply) BEFORE the first message threw
 *   `ConfigurationError: Agent must be fully initialized before changing model configuration`
 * because the Robota agent initializes lazily on the first `run()`, while `setModel` requires full
 * initialization.
 *
 * The original PRESET-013 unit test mocked the entire `Robota` class (so `setModel`'s init guard was
 * never exercised). This test uses a REAL Robota + real provider and never calls `run()`, so it
 * drives the exact path that failed in production. `applyModelOptions` must bring the agent to a
 * ready state (`robota.ensureReady()`) and succeed.
 */

import { describe, it, expect } from 'vitest';

import { AbstractAIProvider } from '@robota-sdk/agent-core';
import { Session } from '../session.js';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

/** Minimal real provider — no network; enough for a real Robota to initialize. */
class ColdTestProvider extends AbstractAIProvider {
  readonly name = 'cold-test-provider';
  readonly version = '1.0.0';

  override async chat(): Promise<TUniversalMessage> {
    return { role: 'assistant', content: 'ok', state: 'complete', timestamp: new Date() };
  }
}

const MOCK_TERMINAL = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: async () => '',
  select: async () => '',
  spinner: () => ({ stop: () => {}, update: () => {} }),
};

function buildColdSession(): Session {
  return new Session({
    tools: [],
    provider: new ColdTestProvider() as never,
    systemMessage: 'test',
    terminal: MOCK_TERMINAL as never,
    model: 'base-model',
  });
}

describe('SessionBase.applyModelOptions — cold session (regression)', () => {
  it('applies model/effort on a never-run session without throwing the "must be fully initialized" guard', async () => {
    const session = buildColdSession();

    // No session.run() has happened — the agent is lazily uninitialized, exactly like a TUI session
    // sitting at "Idle" before the first message. This must NOT throw.
    await expect(
      session.applyModelOptions({ effort: 'high', model: 'switched-model' }),
    ).resolves.toBeUndefined();

    expect(session.getModelId()).toBe('switched-model');
  });

  it('applies effort-only on a cold session and stays usable', async () => {
    const session = buildColdSession();
    await expect(session.applyModelOptions({ effort: 'medium' })).resolves.toBeUndefined();
  });
});
