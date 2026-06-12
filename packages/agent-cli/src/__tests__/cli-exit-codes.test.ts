/**
 * Exit-code contract tests (CLI-064).
 *
 * Print mode must exit 3 on provider configuration errors (typed
 * ProviderConfigError) so automation can distinguish "reconfigure, do not
 * retry" from runtime failures (exit 1). Non-print startup keeps exit 1.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../cli.js';

import type {
  IAIProvider,
  IProviderDefinition,
  IRawProviderResponse,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const TMP_BASE = join(tmpdir(), `robota-cli-exit-codes-test-${process.pid}`);
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

/**
 * Provider env keys that would trigger env-default synthesis (CLI-066) and mask the
 * no-configuration error these tests assert. Neutralized per test, restored after.
 */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'DASHSCOPE_API_KEY',
  'DEEPSEEK_API_KEY',
] as const;

describe('provider config error exit codes (CLI-064)', () => {
  let project: string;
  let savedEnvKeys: Record<string, string | undefined>;

  beforeEach(() => {
    project = join(TMP_BASE, `project-${Math.random().toString(36).slice(2)}`);
    mkdirSync(project, { recursive: true });
    process.env.HOME = join(TMP_BASE, 'home');
    savedEnvKeys = {};
    for (const key of PROVIDER_ENV_KEYS) {
      savedEnvKeys[key] = process.env[key];
      delete process.env[key];
    }
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    for (const key of PROVIDER_ENV_KEYS) {
      if (savedEnvKeys[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnvKeys[key];
    }
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('TC-03: print mode with no provider configuration exits 3 with guidance on stderr', async () => {
    process.argv = ['node', 'robota', '-p', 'say hi'];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(startCli()).rejects.toThrow('process.exit:3');

    expect(stderr.mock.calls.join('')).toContain('No provider configuration found');
  });

  it('TC-03: non-print startup with no provider configuration keeps exit 1', async () => {
    process.argv = ['node', 'robota'];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(startCli()).rejects.toThrow('process.exit:1');

    expect(stderr.mock.calls.join('')).toContain('No provider configuration found');
  });

  it('TC-06 (CLI-066): env-default startup runs print mode and prints the notice exactly once', async () => {
    process.env['FAKE_ZERO_CONF_KEY'] = 'fake-secret-value';
    try {
      process.argv = ['node', 'robota', '-p', 'say hi', '--no-session-persistence'];
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const zeroConfDefinition: IProviderDefinition = {
        type: 'fakezero',
        defaults: { model: 'fake-zero-model', apiKey: '$ENV:FAKE_ZERO_CONF_KEY' },
        requiresApiKey: true,
        createProvider: () => createFakeProvider(),
      };

      await expect(startCli({ providerDefinitions: [zeroConfDefinition] })).rejects.toThrow(
        'process.exit:0',
      );

      const stderrText = stderr.mock.calls.join('');
      const noticeCount =
        stderrText.split('Using fakezero (fake-zero-model) via FAKE_ZERO_CONF_KEY').length - 1;
      expect(noticeCount).toBe(1);
      expect(stderrText).not.toContain('fake-secret-value');
      expect(stdout.mock.calls.join('')).toContain('done');
    } finally {
      delete process.env['FAKE_ZERO_CONF_KEY'];
    }
  });
});

function createFakeProvider(): IAIProvider {
  return {
    name: 'fakezero',
    version: 'test',
    async chat(): Promise<TUniversalMessage> {
      return {
        id: 'assistant-1',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse(): Promise<IRawProviderResponse> {
      return { content: 'unused' };
    },
    supportsTools(): boolean {
      return true;
    },
    validateConfig(): boolean {
      return true;
    },
  };
}
