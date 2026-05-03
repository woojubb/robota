import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  IAIProvider,
  IChatOptions,
  IProviderDefinition,
  IProviderRequest,
  IRawProviderResponse,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { startCli } from '../cli.js';

const TMP_BASE = join(tmpdir(), `robota-cli-update-check-test-${process.pid}`);
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

const fakeProviderDefinition: IProviderDefinition = {
  type: 'fake',
  defaults: { model: 'fake-model' },
  requiresApiKey: false,
  createProvider: () => createFakeProvider(),
};

type TPrintModeOutputCase = 'text' | 'json' | 'stream-json';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

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

function writeProjectSettings(projectDir: string): void {
  const settingsDir = join(projectDir, '.robota');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, 'settings.json'),
    JSON.stringify(
      {
        currentProvider: 'fake',
        providers: {
          fake: {
            type: 'fake',
            model: 'fake-model',
          },
        },
        provider: {
          name: 'fake',
          model: 'fake-model',
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

describe('CLI update check command', () => {
  afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('checks npm metadata and prints the npm global install command without writing settings', async () => {
    const home = join(TMP_BASE, 'home');
    process.env.HOME = home;
    process.argv = ['node', 'robota', '--check-update'];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ 'dist-tags': { latest: '999.0.0-test.0' } }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    await startCli();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(stdout.mock.calls.join('\n')).toContain("npm install -g '@robota-sdk/agent-cli@latest'");
    expect(stderr).not.toHaveBeenCalled();
    expect(existsSync(join(home, '.robota', 'settings.json'))).toBe(false);
    expect(existsSync(join(home, '.robota', 'update-check.json'))).toBe(true);
  });

  it.each<TPrintModeOutputCase>(['text', 'json', 'stream-json'])(
    'does not perform automatic startup update checks in print mode with %s output',
    async (outputFormat) => {
      const home = join(TMP_BASE, 'headless-home');
      const project = join(TMP_BASE, `project-${outputFormat}`);
      mkdirSync(project, { recursive: true });
      writeProjectSettings(project);
      process.env.HOME = home;
      vi.spyOn(process, 'cwd').mockReturnValue(project);
      const outputArgs = outputFormat === 'text' ? [] : ['--output-format', outputFormat];
      process.argv = [
        'node',
        'robota',
        '-p',
        ...outputArgs,
        '--bare',
        '--no-session-persistence',
        '/help',
      ];
      const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ 'dist-tags': { latest: '999.0.0-test.0' } }),
      );
      vi.stubGlobal('fetch', fetchImpl);
      vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit:${String(code ?? 0)}`);
      });

      await expect(startCli({ providerDefinitions: [fakeProviderDefinition] })).rejects.toThrow(
        'process.exit:0',
      );

      expect(fetchImpl).not.toHaveBeenCalled();
      const stdoutText = stdout.mock.calls.join('');
      expect(stdoutText).toContain('Available commands:');
      expect(stdoutText).toContain('agent');
      expect(stdoutText).not.toContain('Robota update available');
      expect(stderr.mock.calls.join('')).toBe('');
      expect(existsSync(join(home, '.robota', 'update-check.json'))).toBe(false);
    },
  );
});
