import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  IAIProvider,
  IChatOptions,
  IProviderRequest,
  IRawProviderResponse,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { CommandRegistry, InteractiveSession } from '@robota-sdk/agent-sdk';
import { createHeadlessTransport } from '@robota-sdk/agent-transport-headless';
import { createDefaultCliCommandModules } from '../cli.js';

function createFakeProvider(): IAIProvider {
  return {
    name: 'fake',
    version: 'test',
    async chat(
      _messages: TUniversalMessage[],
      _options?: IChatOptions,
    ): Promise<TUniversalMessage> {
      return {
        id: 'assistant-1',
        role: 'assistant',
        content: 'unused',
        timestamp: new Date(),
        state: 'complete',
      };
    },
    async generateResponse(_payload: IProviderRequest): Promise<IRawProviderResponse> {
      return { content: 'unused' };
    },
    supportsTools: () => false,
    validateConfig: () => true,
  };
}

function parseJsonObject(output: string): Record<string, unknown> {
  const parsed = JSON.parse(output) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected JSON object output');
  }
  return parsed as Record<string, unknown>;
}

describe('default CLI command composition', () => {
  it('exposes permissions mode subcommands without composing legacy mode', () => {
    const registry = new CommandRegistry();

    for (const module of createDefaultCliCommandModules({
      cwd: '/workspace',
      providerDefinitions: [],
    })) {
      registry.addModule(module);
    }

    expect(registry.getCommands().map((command) => command.name)).not.toContain('mode');
    expect(registry.getSubcommands('permissions').map((command) => command.name)).toEqual([
      'plan',
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
  });

  it('runs permissions mode changes through headless slash-command execution', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-headless-permissions-'));
    const session = new InteractiveSession({
      cwd,
      provider: createFakeProvider(),
      config: {
        defaultTrustLevel: 'moderate',
        language: 'en',
        provider: {
          name: 'fake',
          model: 'fake-model',
          apiKey: 'test-key',
        },
        permissions: { allow: [], deny: [] },
        env: {},
      },
      bare: true,
      permissionMode: 'default',
      commandModules: createDefaultCliCommandModules({
        cwd,
        providerDefinitions: [],
      }),
    });
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: '/permissions plan',
      });

      session.attachTransport(transport);
      await transport.start();

      expect(transport.getExitCode()).toBe(0);
      expect(session.getSession().getPermissionMode()).toBe('plan');
      expect(parseJsonObject(writes.join('').trim())).toMatchObject({
        type: 'result',
        result: 'Permission mode set to: plan\nPermission mode: plan\nNo session-approved tools.',
        subtype: 'success',
      });
    } finally {
      process.stdout.write = originalWrite;
      await session.shutdown({ reason: 'prompt_input_exit' });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
