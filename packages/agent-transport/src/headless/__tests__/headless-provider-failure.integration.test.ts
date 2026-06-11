/**
 * Provider-failure exit-code integration tests (CLI-064).
 *
 * Drives a real InteractiveSession with a provider whose chat() throws (the 401 class
 * observed in product verification) and asserts the headless transport surfaces the
 * failure: non-zero exit code and an error envelope/stderr message — never exit 0.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InteractiveSession } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { createHeadlessTransport } from '../headless-transport.js';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

type TStandardSessionOptions = Extract<
  TInteractiveSessionOptions,
  { cwd: string; provider: unknown }
>;
type TTestProvider = TStandardSessionOptions['provider'];
type TResolvedConfig = NonNullable<TStandardSessionOptions['config']>;

const AUTH_FAILURE_MESSAGE =
  '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';

function createConfig(): TResolvedConfig {
  return {
    defaultTrustLevel: 'moderate',
    language: 'en',
    provider: {
      name: 'failing-test-provider',
      model: 'failing-test-model',
      apiKey: 'test-key',
    },
    permissions: { allow: [], deny: [] },
    env: {},
  };
}

function createAuthFailingProvider(): TTestProvider {
  return {
    name: 'failing-test-provider',
    version: '1.0.0',
    async chat() {
      throw new Error(AUTH_FAILURE_MESSAGE);
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools() {
      return true;
    },
    validateConfig() {
      return true;
    },
  };
}

function captureStream(stream: NodeJS.WriteStream): { writes: string[]; restore(): void } {
  const writes: string[] = [];
  const originalWrite = stream.write;
  stream.write = ((chunk: string | Uint8Array, encodingOrCallback?: unknown) => {
    writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    if (typeof encodingOrCallback === 'function') {
      encodingOrCallback();
    }
    return true;
  }) as typeof stream.write;
  return {
    writes,
    restore() {
      stream.write = originalWrite;
    },
  };
}

describe('headless provider failure exit codes (CLI-064)', () => {
  let cwd: string | undefined;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('TC-02: text format exits 1 and writes the auth failure to stderr', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-headless-fail-'));
    const session = new InteractiveSession({
      cwd,
      provider: createAuthFailingProvider(),
      config: createConfig(),
      permissionMode: 'bypassPermissions',
      bare: true,
    });
    const stdout = captureStream(process.stdout);
    const stderr = captureStream(process.stderr);

    try {
      const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'say hi' });
      session.attachTransport(transport);
      await transport.start();

      expect(transport.getExitCode()).toBe(1);
      expect(stderr.writes.join('')).toContain('authentication_error');
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });

  it('TC-02: json format exits 1 with subtype error and error_code api_error', async () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-headless-fail-'));
    const session = new InteractiveSession({
      cwd,
      provider: createAuthFailingProvider(),
      config: createConfig(),
      permissionMode: 'bypassPermissions',
      bare: true,
    });
    const stdout = captureStream(process.stdout);
    const stderr = captureStream(process.stderr);

    try {
      const transport = createHeadlessTransport({ outputFormat: 'json', prompt: 'say hi' });
      session.attachTransport(transport);
      await transport.start();

      expect(transport.getExitCode()).toBe(1);
      const parsed: unknown = JSON.parse(stdout.writes.join('').trim());
      expect(parsed).toMatchObject({
        type: 'result',
        subtype: 'error',
        error_code: 'api_error',
      });
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });
});
