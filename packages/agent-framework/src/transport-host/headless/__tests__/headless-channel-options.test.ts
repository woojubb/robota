import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAIProvider } from '@robota-sdk/agent-core';

const sessionCtorSpy = vi.fn();

vi.mock('../../../runtime/runtime-host.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../runtime/runtime-host.js')>();

  class FakeInteractiveSession {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options: unknown) {
      sessionCtorSpy(options);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? [];
      list.push(handler);
      this.listeners.set(event, list);
    }

    off(): void {}

    async submit(): Promise<void> {
      const result = {
        response: 'ok',
        history: [],
        toolSummaries: [],
        contextState: {},
      };
      for (const handler of this.listeners.get('complete') ?? []) {
        handler(result);
      }
    }

    getSession(): { getSessionId: () => string } {
      return { getSessionId: () => 'test-session' };
    }

    async shutdown(): Promise<void> {}
  }

  // RUNTIME-001: construction flows through buildRuntimeSession (wraps InteractiveSession in agent-framework).
  return {
    ...mod,
    InteractiveSession: FakeInteractiveSession,
    buildRuntimeSession: (options: unknown) => new FakeInteractiveSession(options),
  };
});

import { HeadlessInteractionChannel } from '../HeadlessInteractionChannel.js';
import { createNodeHostContributionSource } from '../../../contributions/node-host-contribution-source.js';
import type { IHeadlessInteractionChannelOptions } from '../HeadlessInteractionChannel.js';

describe('HeadlessInteractionChannel session options', () => {
  beforeEach(() => {
    sessionCtorSpy.mockClear();
  });

  it('requires the host to provide shell execution instead of using a framework process default', () => {
    expect(
      () =>
        new HeadlessInteractionChannel({
          cwd: process.cwd(),
          provider: {} as IAIProvider,
          outputFormat: 'text',
        } as IHeadlessInteractionChannelOptions),
    ).toThrow('Headless shell execution must be provided by the host.');
  });

  it('forwards product provider recovery guidance to the live session', async () => {
    const providerErrorGuidance = { authentication: 'Configure product A.' };
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      providerErrorGuidance,
      outputFormat: 'text',
      shellExec: () => '',
    });

    await channel.run('hello');

    expect(sessionCtorSpy.mock.calls[0]?.[0]).toMatchObject({ providerErrorGuidance });
  });

  it('forwards the host-owned shell adapter to the live session unchanged', async () => {
    const shellExec = vi.fn(() => 'host result');
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      shellExec,
    });

    await channel.run('hello');

    expect(sessionCtorSpy.mock.calls[0]?.[0]).toMatchObject({ shellExec });
  });

  it('forwards the host-selected skill roots and sources to the live session', async () => {
    const contributionSources = [createNodeHostContributionSource(process.cwd())];
    const skillRoots = [{ root: 'custom/skills', kind: 'skills' as const }];
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      contributionSources,
      skillRoots,
      outputFormat: 'text',
      shellExec: () => '',
    });

    await channel.run('hello');

    expect(sessionCtorSpy.mock.calls[0]?.[0]).toMatchObject({
      contributionSources,
      skillRoots,
    });
  });

  it('TC-01: passes deniedTools through to the InteractiveSession options', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      allowedTools: ['Read'],
      deniedTools: ['Bash', 'Glob'],
      shellExec: () => '',
    });
    await channel.run('hello');
    expect(sessionCtorSpy).toHaveBeenCalledTimes(1);
    const options = sessionCtorSpy.mock.calls[0]?.[0] as {
      allowedTools?: string[];
      deniedTools?: string[];
    };
    expect(options.allowedTools).toEqual(['Read']);
    expect(options.deniedTools).toEqual(['Bash', 'Glob']);
  });

  it('TC-01 (CLI-063): passes resumeSessionId and forkSession through to the InteractiveSession options', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      resumeSessionId: 'session_prior_abc',
      forkSession: true,
      shellExec: () => '',
    });
    await channel.run('hello');
    expect(sessionCtorSpy).toHaveBeenCalledTimes(1);
    const options = sessionCtorSpy.mock.calls[0]?.[0] as {
      resumeSessionId?: string;
      forkSession?: boolean;
    };
    expect(options.resumeSessionId).toBe('session_prior_abc');
    expect(options.forkSession).toBe(true);
  });

  it('TC-01 (CLI-063): omits resume fields when not provided', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      shellExec: () => '',
    });
    await channel.run('hello');
    const options = sessionCtorSpy.mock.calls[0]?.[0] as {
      resumeSessionId?: string;
      forkSession?: boolean;
    };
    expect(options.resumeSessionId).toBeUndefined();
    expect(options.forkSession).toBeUndefined();
  });

  it('TC-02 (CLI-076): forwards an explicit model override to the session options', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      model: 'claude-nonexistent-model-core020',
      shellExec: () => '',
    });
    await channel.run('hello');
    expect(sessionCtorSpy).toHaveBeenCalledTimes(1);
    const options = sessionCtorSpy.mock.calls[0]?.[0] as { model?: string };
    // The requested model must reach the session verbatim — not be silently swapped for a default.
    expect(options.model).toBe('claude-nonexistent-model-core020');
  });

  it('TC-02 (CLI-076): omits model when not provided (session resolves from config, no substitution)', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      shellExec: () => '',
    });
    await channel.run('hello');
    const options = sessionCtorSpy.mock.calls[0]?.[0] as { model?: string };
    expect(options.model).toBeUndefined();
  });

  it('forwards the resolved organization policy unchanged to the session', async () => {
    const orgPolicy = { blockedCommands: ['clear'], adminContact: 'ops@example.test' };
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      orgPolicy,
      shellExec: () => '',
    } as never);

    await channel.run('hello');

    expect(sessionCtorSpy.mock.calls[0]?.[0]).toMatchObject({ orgPolicy });
  });

  it('preserves print preset generation and prompt capabilities at the session boundary', async () => {
    const responseFormat = { type: 'json_object' as const };
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      temperature: 0.37,
      maxOutputTokens: 481,
      language: 'ko',
      presetSystemPrompt: 'Preset seed',
      responseFormat,
      shellExec: () => '',
    });

    await channel.run('hello');

    expect(sessionCtorSpy.mock.calls[0]?.[0]).toMatchObject({
      temperature: 0.37,
      maxOutputTokens: 481,
      language: 'ko',
      presetSystemPrompt: 'Preset seed',
      responseFormat,
    });
  });
});
