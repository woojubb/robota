/**
 * Provider-failure exit-code integration tests (CLI-064).
 *
 * Drives a real InteractiveSession with a provider whose chat() throws (the 401 class
 * observed in product verification) and asserts the headless transport surfaces the
 * failure: non-zero exit code and an error envelope/stderr message — never exit 0.
 */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InteractiveSession } from '../../../interactive/interactive-session.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createHeadlessTransport } from '../headless-transport.js';

import type { TInteractiveSessionOptions } from '../../../interactive/interactive-session-options.js';

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
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-headless-fail-')));
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
      await transport.waitForCompletion();

      expect(transport.getExitCode()).toBe(1);
      expect(stderr.writes.join('')).toContain('authentication_error');
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });

  it('TC-02: json format exits 1 with subtype error and error_code api_error', async () => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-headless-fail-')));
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
      await transport.waitForCompletion();

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

  it('CORE-027: a failure whose prose says "abort" exits non-zero, not as a successful interruption', async () => {
    // The user-execution scenario, run by the harness: a provider failure of exactly the
    // shape 'connection aborted by peer' used to come back success: true, interrupted: true —
    // empty response, exit 0, nothing downstream able to tell it from a user interruption.
    //
    // SCENARIO COVERAGE, not a red-proof of this change: measured against develop's sources
    // this case already passes (the abort-prose misclassification fell to the earlier
    // isAbortFailure fix). What it pins is the end-to-end exit contract through a real
    // InteractiveSession and headless transport; the identity-preservation red-proofs live in
    // the agent-core unit tests beside execution-failure.ts.
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-headless-fail-')));
    const provider = createAuthFailingProvider();
    provider.chat = async () => {
      throw new Error('connection aborted by peer');
    };
    const session = new InteractiveSession({
      cwd,
      provider,
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
      await transport.waitForCompletion();

      expect(transport.getExitCode(), 'an abort-prose failure exited zero').toBe(1);
      expect(stderr.writes.join('')).toContain('connection aborted by peer');
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });
});
