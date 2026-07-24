/**
 * CMD-004 Stage D — headless/programmatic HOST-ACTION PARITY for the transport core.
 *
 * The LSP `workspace/executeCommand` model the spec adopts: a command's host actions are executed
 * by the SESSION (the host) via the injected `ICommandHostAdapters` — with ZERO surfaces attached.
 * A headless or programmatic embedder therefore gets the SAME command semantics as the TUI/GUI:
 * `/language ko` writes settings and requests a restart with no renderer anywhere in the process.
 * The no-fallback floor also holds headless: an action whose adapter is not wired yields an
 * EXPLICIT failure in the command result — never a silent skip.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createLanguageCommandModule,
  createSettingsCommandModule,
} from '@robota-sdk/agent-command';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgrammaticAgent } from '../programmatic/index.js';

import type { ICommandHostAdapters, ICommandModule } from '@robota-sdk/agent-framework';
import type { IAgentDriver, InteractionEvent } from '@robota-sdk/agent-interface-transport';

/** The minimal runtime-session stub the InteractiveSession wraps (no provider turn is run here). */
function createRuntimeSession(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'session_headless_parity',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

/** A zero-surface session: NOTHING subscribes to its events — the pure headless embedding. */
function headlessSession(adapters: ICommandHostAdapters): InteractiveSession {
  return new InteractiveSession({
    session: createRuntimeSession() as never,
    commandModules: [createLanguageCommandModule(), createSettingsCommandModule()],
    commandHostAdapters: adapters,
  });
}

describe('CMD-004 Stage D — host-action parity with ZERO attached surfaces (headless)', () => {
  it('/language ko writes via the settings adapter and requests a restart — no surface anywhere', async () => {
    const write = vi.fn();
    const requestRestart = vi.fn();
    const session = headlessSession({
      settings: { read: () => ({}), write },
      process: { requestExit: vi.fn(), requestRestart },
    });

    const result = await session.executeCommand('language', 'ko', 'user');

    expect(result?.success).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ language: 'ko' }));
    expect(requestRestart).toHaveBeenCalledTimes(1);
    // Applied host actions are consumed — a surface that later replays the result cannot re-apply.
    expect(result?.hostActions).toBeUndefined();
  });

  it('an absent adapter is an EXPLICIT failure in the result — never a silent skip (no-fallback)', async () => {
    // No process adapter wired: the language change cannot restart → explicit failure naming the gap.
    const write = vi.fn();
    const session = headlessSession({ settings: { read: () => ({}), write } });

    const result = await session.executeCommand('language', 'ko', 'user');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain("Cannot apply 'language-change'");
    expect(result?.message).toContain('not available in this environment');
  });
});

/** A command emitting a direct (Stage-E shape) host action — used through the programmatic driver. */
const RELOAD_LANGUAGE_MODULE: ICommandModule = {
  name: 'parity',
  systemCommands: [
    {
      name: 'parity-language',
      description: 'host-action parity probe',
      userInvocable: true,
      safety: 'read-only',
      requiresPermission: false,
      execute: () => ({
        message: 'Language set to ko.',
        success: true,
        hostActions: [{ type: 'language-change', language: 'ko' }],
      }),
    },
  ],
};

function commandOutputs(events: readonly InteractionEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<InteractionEvent, { type: 'command-result' }> =>
        e.type === 'command-result',
    )
    .map((e) => e.output);
}

describe('CMD-004 Stage D — programmatic driver surface (no adapters wired)', () => {
  let cwd: string;
  let driver: IAgentDriver | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-parity-'));
  });
  afterEach(async () => {
    await driver?.stop();
    driver = undefined;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('a host action reaching an adapter-less programmatic embedding fails EXPLICITLY, visibly in the command-result', async () => {
    const scripted = createScriptedProvider([{ text: 'unused' }]);
    driver = createProgrammaticAgent({
      provider: scripted.provider,
      cwd,
      commandModules: [RELOAD_LANGUAGE_MODULE],
    });
    await driver.start();

    await driver.send('/parity-language');

    // The whole programmatic stack surfaces the no-fallback failure as DATA — not a silent no-op.
    const outputs = commandOutputs(driver.events);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toContain("Cannot apply 'language-change'");
    expect(outputs[0]).toContain('not available in this environment');
  });
});
