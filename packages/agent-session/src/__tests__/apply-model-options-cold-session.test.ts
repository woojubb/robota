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
    return {
      id: 'msg-cold-1',
      role: 'assistant',
      content: 'ok',
      state: 'complete',
      timestamp: new Date(),
    };
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
    cwd: process.cwd(),
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

  it('scopes an effort override and restores the previous effort after success', async () => {
    const session = buildColdSession();
    await session.applyModelOptions({ effort: 'low' });

    await session.withScopedModelEffort('high', async () => {
      expect(session.getModelEffort()).toBe('high');
    });

    expect(session.getModelEffort()).toBe('low');
  });

  it('restores the previous effort when the scoped operation fails', async () => {
    const session = buildColdSession();
    await session.applyModelOptions({ effort: 'low' });
    const failure = new Error('scoped failure');

    await expect(
      session.withScopedModelEffort('high', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(session.getModelEffort()).toBe('low');
  });

  it('restores nested scopes to their enclosing effort before the outer scope', async () => {
    const session = buildColdSession();
    await session.applyModelOptions({ effort: 'low' });

    await session.withScopedModelEffort('medium', async () => {
      await session.withScopedModelEffort('high', async () => {
        expect(session.getModelEffort()).toBe('high');
      });
      expect(session.getModelEffort()).toBe('medium');
    });

    expect(session.getModelEffort()).toBe('low');
  });

  it('restores the previous effort when the scoped operation is cancelled', async () => {
    const session = buildColdSession();
    await session.applyModelOptions({ effort: 'low' });
    const cancellation = new DOMException('cancelled', 'AbortError');

    await expect(
      session.withScopedModelEffort('high', async () => {
        throw cancellation;
      }),
    ).rejects.toBe(cancellation);

    expect(session.getModelEffort()).toBe('low');
  });
});
