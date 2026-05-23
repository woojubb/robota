import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDefaultCommandModules } from '@robota-sdk/agent-command';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  IAIProvider,
  IChatOptions,
  IProviderRequest,
  IRawProviderResponse,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const noopProviderSettingsAdapter = {
  readMergedSettings: () => ({}) as never,
  readTargetSettings: () => ({}) as never,
  writeTargetSettings: () => undefined,
};

function createEchoProvider(responseText = 'Hello from provider'): IAIProvider {
  return {
    name: 'echo',
    version: 'test',
    async chat(
      _messages: TUniversalMessage[],
      _options?: IChatOptions,
    ): Promise<TUniversalMessage> {
      return {
        id: 'echo-1',
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        state: 'complete',
      };
    },
    async generateResponse(_payload: IProviderRequest): Promise<IRawProviderResponse> {
      return { content: responseText };
    },
    supportsTools: () => false,
    validateConfig: () => true,
  };
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    fn()
      .then(() => {
        process.stdout.write = original;
        resolve(chunks.join(''));
      })
      .catch((err: unknown) => {
        process.stdout.write = original;
        reject(err);
      });
  });
}

describe('print-mode output format integration', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-print-mode-'));
  });

  afterEach(async () => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function buildSession(
    opts: { maxTurns?: number; permissionMode?: 'bypassPermissions' | 'default' | 'plan' } = {},
  ) {
    return new InteractiveSession({
      cwd,
      provider: createEchoProvider(),
      config: {
        defaultTrustLevel: 'moderate',
        language: 'en',
        provider: { name: 'echo', model: 'test', apiKey: 'test' },
        permissions: { allow: [], deny: [] },
        env: {},
      },
      bare: true,
      permissionMode: opts.permissionMode ?? 'bypassPermissions',
      maxTurns: opts.maxTurns,
      commandModules: createDefaultCommandModules({
        cwd,
        providerDefinitions: [],
        providerSettingsAdapter: noopProviderSettingsAdapter,
      }),
    });
  }

  it('emits JSON result envelope for --output-format json', async () => {
    const session = buildSession();
    const output = await captureStdout(async () => {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: '/permissions default',
      });
      session.attachTransport(transport);
      await transport.start();
      expect(transport.getExitCode()).toBe(0);
      await session.shutdown({ reason: 'prompt_input_exit' });
    });
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed['type']).toBe('result');
    expect(parsed['subtype']).toBe('success');
    expect(typeof parsed['result']).toBe('string');
  });

  it('emits newline-delimited JSON for --output-format stream-json', async () => {
    const session = buildSession();
    const output = await captureStdout(async () => {
      const transport = createHeadlessTransport({
        outputFormat: 'stream-json',
        prompt: '/permissions plan',
      });
      session.attachTransport(transport);
      await transport.start();
      expect(transport.getExitCode()).toBe(0);
      await session.shutdown({ reason: 'prompt_input_exit' });
    });
    const lines = output
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      expect(typeof obj['type']).toBe('string');
    }
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    expect(last['type']).toBe('result');
  });

  it('emits plain text for --output-format text', async () => {
    const session = buildSession();
    const output = await captureStdout(async () => {
      const transport = createHeadlessTransport({
        outputFormat: 'text',
        prompt: '/permissions default',
      });
      session.attachTransport(transport);
      await transport.start();
      expect(transport.getExitCode()).toBe(0);
      await session.shutdown({ reason: 'prompt_input_exit' });
    });
    // text mode should not be a JSON object
    expect(() => JSON.parse(output.trim())).toThrow();
    expect(output.length).toBeGreaterThan(0);
  });

  it('respects bypassPermissions mode — session executes without approval prompts', async () => {
    const session = buildSession({ permissionMode: 'bypassPermissions' });
    const output = await captureStdout(async () => {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: '/permissions bypassPermissions',
      });
      session.attachTransport(transport);
      await transport.start();
      await session.shutdown({ reason: 'prompt_input_exit' });
    });
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed['subtype']).toBe('success');
    expect(String(parsed['result'])).toContain('bypassPermissions');
  });

  it('respects plan permission mode', async () => {
    const session = buildSession({ permissionMode: 'plan' });
    const output = await captureStdout(async () => {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: '/permissions plan',
      });
      session.attachTransport(transport);
      await transport.start();
      await session.shutdown({ reason: 'prompt_input_exit' });
    });
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed['subtype']).toBe('success');
    expect(session.getSession().getPermissionMode()).toBe('plan');
  });
});

describe('runPrintMode dry-run and exit code', () => {
  let cwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-dry-run-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw Object.assign(new Error(`process.exit(${_code ?? 0})`), { code: _code ?? 0 });
    });
  });

  afterEach(async () => {
    exitSpy.mockRestore();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('prints DRY RUN banner when dryRun option is set', async () => {
    const { runPrintMode } = await import('../modes/print-mode.js');
    const { createAgentRuntime } = await import('@robota-sdk/agent-framework');
    const { createDefaultCommandModules } = await import('@robota-sdk/agent-command');

    const runtime = createAgentRuntime({
      cwd,
      provider: createEchoProvider(),
      commandModules: createDefaultCommandModules({
        cwd,
        providerDefinitions: [],
        providerSettingsAdapter: noopProviderSettingsAdapter,
      }),
    });

    const output = await captureStdout(async () => {
      try {
        await runPrintMode(
          {
            positional: ['hello'],
            dryRun: true,
            outputFormat: 'text',
            permissionMode: 'bypassPermissions',
            noSessionPersistence: true,
            bare: true,
          } as Parameters<typeof runPrintMode>[0],
          runtime,
        );
      } catch {
        // process.exit throws via spy
      }
    });

    expect(output).toContain('DRY RUN');
  });

  it('exits with code 0 on success', async () => {
    const { runPrintMode } = await import('../modes/print-mode.js');
    const { createAgentRuntime } = await import('@robota-sdk/agent-framework');
    const { createDefaultCommandModules } = await import('@robota-sdk/agent-command');

    const runtime = createAgentRuntime({
      cwd,
      provider: createEchoProvider(),
      commandModules: createDefaultCommandModules({
        cwd,
        providerDefinitions: [],
        providerSettingsAdapter: noopProviderSettingsAdapter,
      }),
    });

    let exitCode: number | undefined;
    await captureStdout(async () => {
      try {
        await runPrintMode(
          {
            positional: ['hello'],
            dryRun: false,
            outputFormat: 'text',
            permissionMode: 'bypassPermissions',
            noSessionPersistence: true,
            bare: true,
          } as Parameters<typeof runPrintMode>[0],
          runtime,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('process.exit(')) {
          exitCode = (err as Error & { code: number }).code;
        }
      }
    });

    expect(exitCode).toBe(0);
  });
});
