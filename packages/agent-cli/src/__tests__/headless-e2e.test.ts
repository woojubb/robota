/**
 * CLI-033: Headless E2E test suite — covers runPrintMode scenarios
 * that are not addressed by print-mode-integration.test.ts.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDefaultCommandModules } from '@robota-sdk/agent-command';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

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

function createEchoProvider(responseText = 'Echo response'): IAIProvider {
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

/** Provider that reflects the system message in its response for testing --system-prompt. */
function createSystemReflectProvider(): IAIProvider {
  let capturedSystemMessage = '';
  return {
    name: 'reflect',
    version: 'test',
    async chat(messages: TUniversalMessage[], _options?: IChatOptions): Promise<TUniversalMessage> {
      const systemMsg = messages.find((m) => m.role === 'system');
      capturedSystemMessage = typeof systemMsg?.content === 'string' ? systemMsg.content : '';
      return {
        id: 'reflect-1',
        role: 'assistant',
        content: `SYSTEM:${capturedSystemMessage}`,
        timestamp: new Date(),
        state: 'complete',
      };
    },
    async generateResponse(_payload: IProviderRequest): Promise<IRawProviderResponse> {
      return { content: `SYSTEM:${capturedSystemMessage}` };
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

describe('CLI-033: headless E2E — runPrintMode scenarios', () => {
  let cwd: string;
  let exitSpy: MockInstance<Parameters<typeof process.exit>, ReturnType<typeof process.exit>>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-e2e-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: string | number | null) => {
      const code = typeof _code === 'number' ? _code : 0;
      throw Object.assign(new Error(`process.exit(${code})`), { code });
    }) as (code?: string | number | null) => never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    rmSync(cwd, { recursive: true, force: true });
  });

  async function runPrint(
    opts: Record<string, unknown>,
    provider: IAIProvider = createEchoProvider(),
  ): Promise<{ output: string; exitCode: number }> {
    const { runPrintMode } = await import('../modes/print-mode.js');
    const runtime = createAgentRuntime({
      cwd,
      provider,
      commandModules: createDefaultCommandModules({
        cwd,
        providerDefinitions: [],
        providerSettingsAdapter: noopProviderSettingsAdapter,
      }),
    });

    let exitCode = 0;
    const output = await captureStdout(async () => {
      try {
        await runPrintMode(
          {
            positional: ['hello world'],
            dryRun: false,
            outputFormat: 'text',
            permissionMode: 'bypassPermissions',
            noSessionPersistence: true,
            bare: true,
            continueMode: false,
            forkSession: false,
            ...opts,
          } as Parameters<typeof runPrintMode>[0],
          runtime,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('process.exit(')) {
          exitCode = (err as Error & { code: number }).code;
        }
      }
    });
    return { output, exitCode };
  }

  it('exits 0 and produces output for a basic prompt', async () => {
    const { output, exitCode } = await runPrint({});
    expect(exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });

  it('--output-format json produces a valid result envelope', async () => {
    const { output, exitCode } = await runPrint({ outputFormat: 'json' });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed['type']).toBe('result');
    expect(parsed['subtype']).toBe('success');
  });

  it('--output-format stream-json produces newline-delimited JSON', async () => {
    const { output, exitCode } = await runPrint({ outputFormat: 'stream-json' });
    expect(exitCode).toBe(0);
    const lines = output
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
    expect(last['type']).toBe('result');
  });

  it('--system-prompt is accepted without error and session completes successfully', async () => {
    const { output, exitCode } = await runPrint({ systemPrompt: 'Always respond in formal tone.' });
    expect(exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });

  it('--system-prompt value is included in the system message sent to provider', async () => {
    const provider = createSystemReflectProvider();
    const { output, exitCode } = await runPrint(
      { systemPrompt: 'CUSTOM_SYSTEM_INSTRUCTIONS', outputFormat: 'text' },
      provider,
    );
    expect(exitCode).toBe(0);
    expect(output).toContain('CUSTOM_SYSTEM_INSTRUCTIONS');
  });

  it('--append-system-prompt is accepted without error and session completes successfully', async () => {
    const { output, exitCode } = await runPrint({
      appendSystemPrompt: 'End every response with a disclaimer.',
    });
    expect(exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });

  it('--max-turns 1 completes session with one turn', async () => {
    const { exitCode } = await runPrint({ maxTurns: 1 });
    expect(exitCode).toBe(0);
  });

  it('--dry-run includes DRY RUN banner in output', async () => {
    const { output, exitCode } = await runPrint({ dryRun: true, positional: ['summarize this'] });
    expect(exitCode).toBe(0);
    expect(output).toContain('DRY RUN');
  });

  it('--permission-mode plan is reflected in session state', async () => {
    const { InteractiveSession } = await import('@robota-sdk/agent-framework');
    const { createHeadlessTransport } = await import('@robota-sdk/agent-transport/headless');

    const session = new InteractiveSession({
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
      permissionMode: 'plan',
      commandModules: createDefaultCommandModules({
        cwd,
        providerDefinitions: [],
        providerSettingsAdapter: noopProviderSettingsAdapter,
      }),
    });

    await captureStdout(async () => {
      const transport = createHeadlessTransport({
        outputFormat: 'json',
        prompt: '/permissions plan',
      });
      session.attachTransport(transport);
      await transport.start();
      expect(transport.getExitCode()).toBe(0);
      await session.shutdown({ reason: 'prompt_input_exit' });
    });

    expect(session.getSession().getPermissionMode()).toBe('plan');
  });
});

describe('CLI-033: Node.js version check', () => {
  it('process.versions.node major is >=22', () => {
    const [major] = process.versions.node.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(22);
  });
});

/**
 * CLI-038: stdin + positional combined prompt tests
 *
 * TC-04 (E2E spawn) is marked manual because it requires the CLI binary to be
 * built and a real provider key to be present in the environment. The behaviour
 * is fully covered by TC-01/TC-02/TC-03 unit tests in this describe block via
 * the runPrintMode integration harness.
 */
describe('CLI-038: stdin + positional combined prompt', () => {
  let cwd: string;
  let exitSpy: MockInstance<Parameters<typeof process.exit>, ReturnType<typeof process.exit>>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-cli038-'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: string | number | null) => {
      const code = typeof _code === 'number' ? _code : 0;
      throw Object.assign(new Error(`process.exit(${code})`), { code });
    }) as (code?: string | number | null) => never);
    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  /** Replace process.stdin with a readable async iterable that yields the given string. */
  function mockStdinWith(content: string): void {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const buf = Buffer.from(content, 'utf-8');
    let done = false;
    const asyncIterable = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Buffer>> {
            if (!done) {
              done = true;
              return Promise.resolve({ value: buf, done: false });
            }
            return Promise.resolve({ value: undefined as unknown as Buffer, done: true });
          },
        };
      },
    };
    Object.assign(process.stdin, asyncIterable);
  }

  async function runWithStdin(
    opts: Record<string, unknown>,
    provider: IAIProvider = createEchoProvider(),
  ): Promise<{ output: string; exitCode: number }> {
    const { runPrintMode } = await import('../modes/print-mode.js');
    const { createAgentRuntime } = await import('@robota-sdk/agent-framework');
    const { createDefaultCommandModules } = await import('@robota-sdk/agent-command');

    const runtime = createAgentRuntime({
      cwd,
      provider,
      commandModules: createDefaultCommandModules({
        cwd,
        providerDefinitions: [],
        providerSettingsAdapter: noopProviderSettingsAdapter,
      }),
    });

    let exitCode = 0;
    const output = await captureStdout(async () => {
      try {
        await runPrintMode(
          {
            positional: [],
            dryRun: false,
            outputFormat: 'text',
            permissionMode: 'bypassPermissions',
            noSessionPersistence: true,
            bare: true,
            continueMode: false,
            forkSession: false,
            ...opts,
          } as Parameters<typeof runPrintMode>[0],
          runtime,
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.message.startsWith('process.exit(')) {
          exitCode = (err as Error & { code: number }).code;
        }
      }
    });
    return { output, exitCode };
  }

  // TC-01: positional + stdin → both delivered together
  it('TC-01: combines positional and piped stdin into a single prompt with <stdin> tag', async () => {
    /** Provider that captures the prompt sent to it and echoes it back */
    function createPromptCaptureProvider(): IAIProvider & { capturedPrompt: string } {
      const p = {
        capturedPrompt: '',
        name: 'capture',
        version: 'test',
        async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
          const user = messages.find((m) => m.role === 'user');
          p.capturedPrompt = typeof user?.content === 'string' ? user.content : '';
          return {
            id: 'c-1',
            role: 'assistant',
            content: 'ok',
            timestamp: new Date(),
            state: 'complete',
          };
        },
        async generateResponse(): Promise<IRawProviderResponse> {
          return { content: 'ok' };
        },
        supportsTools: () => false,
        validateConfig: () => true,
      };
      return p;
    }

    const provider = createPromptCaptureProvider();
    mockStdinWith('console.log("hello")');

    const { exitCode } = await runWithStdin({ positional: ['Review'] }, provider);
    expect(exitCode).toBe(0);
    expect(provider.capturedPrompt).toContain('Review');
    expect(provider.capturedPrompt).toContain('<stdin>');
    expect(provider.capturedPrompt).toContain('console.log("hello")');
    expect(provider.capturedPrompt).toContain('</stdin>');
  });

  // TC-02: stdin only (empty positional) → stdin used as prompt
  it('TC-02: uses stdin as prompt when positional is empty', async () => {
    function createPromptCaptureProvider(): IAIProvider & { capturedPrompt: string } {
      const p = {
        capturedPrompt: '',
        name: 'capture2',
        version: 'test',
        async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
          const user = messages.find((m) => m.role === 'user');
          p.capturedPrompt = typeof user?.content === 'string' ? user.content : '';
          return {
            id: 'c-2',
            role: 'assistant',
            content: 'ok',
            timestamp: new Date(),
            state: 'complete',
          };
        },
        async generateResponse(): Promise<IRawProviderResponse> {
          return { content: 'ok' };
        },
        supportsTools: () => false,
        validateConfig: () => true,
      };
      return p;
    }

    const provider = createPromptCaptureProvider();
    mockStdinWith('What is 2+2?');

    const { exitCode } = await runWithStdin({ positional: [] }, provider);
    expect(exitCode).toBe(0);
    expect(provider.capturedPrompt).toBe('What is 2+2?');
  });

  // TC-03: positional only (isTTY=true) → stdin not read, positional used as-is
  it('TC-03: uses only positional when stdin is a TTY (no pipe)', async () => {
    // Restore TTY mode so stdin is NOT read
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    function createPromptCaptureProvider(): IAIProvider & { capturedPrompt: string } {
      const p = {
        capturedPrompt: '',
        name: 'capture3',
        version: 'test',
        async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
          const user = messages.find((m) => m.role === 'user');
          p.capturedPrompt = typeof user?.content === 'string' ? user.content : '';
          return {
            id: 'c-3',
            role: 'assistant',
            content: 'ok',
            timestamp: new Date(),
            state: 'complete',
          };
        },
        async generateResponse(): Promise<IRawProviderResponse> {
          return { content: 'ok' };
        },
        supportsTools: () => false,
        validateConfig: () => true,
      };
      return p;
    }

    const provider = createPromptCaptureProvider();

    const { exitCode } = await runWithStdin({ positional: ['Summarize this'] }, provider);
    expect(exitCode).toBe(0);
    expect(provider.capturedPrompt).toBe('Summarize this');
    expect(provider.capturedPrompt).not.toContain('<stdin>');
  });

  // TC-04: E2E spawn test — manual / skipped (requires built CLI binary + provider key)
  it.skip('TC-04 (manual): E2E spawn with piped stdin — skipped: requires built CLI binary and a real provider key in the environment', () => {
    /**
     * To verify manually:
     *   pnpm build
     *   echo "console.log('hello')" | node dist/bin.js -p "Review this code"
     * Expected: output references stdin content wrapped in <stdin>…</stdin>.
     */
  });
});
