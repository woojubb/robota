import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCli } from '../cli.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

const originalArgv = process.argv;
const originalHome = process.env.HOME;
const originalFakeKey = process.env['ROBOTA_LIVE_TRACE_TEST_KEY'];
const telemetryKeys = [
  'ROBOTA_TELEMETRY_ENABLED', 'ROBOTA_TELEMETRY_TRACES', 'ROBOTA_TELEMETRY_OTLP_PROTOCOL',
  'ROBOTA_TELEMETRY_OTLP_ENDPOINT', 'ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT', 'ROBOTA_TELEMETRY_OTLP_HEADERS',
] as const;
const originalTelemetry = Object.fromEntries(telemetryKeys.map((key) => [key, process.env[key]]));

const providerDefinition: IProviderDefinition = {
  type: 'livetrace-no-mix-test',
  defaults: { model: 'test-model', apiKey: '$ENV:ROBOTA_LIVE_TRACE_TEST_KEY' },
  requiresApiKey: true,
  createProvider: (): IAIProvider => ({
    name: 'livetrace-no-mix-test', version: 'test',
    async chat() {
      return { id: 'assistant-1', role: 'assistant', content: 'private response',
        state: 'complete', timestamp: new Date() };
    },
    async generateResponse() { return { content: 'unused' }; },
    supportsTools: () => true,
    validateConfig: () => true,
  }),
};

interface ICapturedRequest { readonly authorization?: string }

function startCapturingServer(bucket: ICapturedRequest[]): Promise<{ endpoint: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bucket.push({ ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) });
    response.writeHead(200, { 'content-type': 'application/x-protobuf' });
    response.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      resolve({
        endpoint: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((res, rej) => server.close((error) => error ? rej(error) : res())),
      });
    });
  });
}

describe('CLI live trace settings across in-process calls never mix', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    process.env.HOME = originalHome;
    if (originalFakeKey === undefined) delete process.env['ROBOTA_LIVE_TRACE_TEST_KEY'];
    else process.env['ROBOTA_LIVE_TRACE_TEST_KEY'] = originalFakeKey;
    for (const key of telemetryKeys) {
      const original = originalTelemetry[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it('never sends the first call\'s credential header to a second call\'s different destination', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-cli-no-mix-header-home-'));
    process.env.HOME = home;
    process.env['ROBOTA_LIVE_TRACE_TEST_KEY'] = 'test-only-key';
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'robota', '-p', 'private prompt', '--no-session-persistence'];

    const requestsA: ICapturedRequest[] = [];
    const requestsB: ICapturedRequest[] = [];
    const serverA = await startCapturingServer(requestsA);
    const serverB = await startCapturingServer(requestsB);
    try {
      // Call 1: destination A, with a credential header configured FOR A.
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = serverA.endpoint;
      process.env['ROBOTA_TELEMETRY_OTLP_HEADERS'] = 'Authorization=Bearer%20credA';
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requestsA).toHaveLength(1);
      expect(requestsA[0]!.authorization).toBe('Bearer credA');
      expect(requestsB).toHaveLength(0);

      // Call 2, same process: a DIFFERENT destination B, no header of its own. Credential A must
      // never reach B, and A must not receive a second request either.
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = serverB.endpoint;
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requestsA).toHaveLength(1);
      expect(requestsB).toHaveLength(1);
      expect(requestsB[0]!.authorization).toBeUndefined();
    } finally {
      await serverA.close();
      await serverB.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('never keeps sending to a first call\'s signal-specific endpoint once a second call names a different generic one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-cli-no-mix-endpoint-home-'));
    process.env.HOME = home;
    process.env['ROBOTA_LIVE_TRACE_TEST_KEY'] = 'test-only-key';
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'robota', '-p', 'private prompt', '--no-session-persistence'];

    const requestsA: ICapturedRequest[] = [];
    const requestsB: ICapturedRequest[] = [];
    const serverA = await startCapturingServer(requestsA);
    const serverB = await startCapturingServer(requestsB);
    try {
      // Call 1: an exact, signal-specific traces endpoint, A.
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT'] = `${serverA.endpoint}/v1/traces`;
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requestsA).toHaveLength(1);
      expect(requestsB).toHaveLength(0);

      // Call 2, same process: only a generic endpoint B, no signal-specific override at all. A's
      // earlier signal-specific endpoint must not win a second export.
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = serverB.endpoint;
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requestsA).toHaveLength(1);
      expect(requestsB).toHaveLength(1);
    } finally {
      await serverA.close();
      await serverB.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('turns export off for a later call that sets only ROBOTA_TELEMETRY_ENABLED=0', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-cli-no-mix-off-home-'));
    process.env.HOME = home;
    process.env['ROBOTA_LIVE_TRACE_TEST_KEY'] = 'test-only-key';
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'robota', '-p', 'private prompt', '--no-session-persistence'];

    const requests: ICapturedRequest[] = [];
    const server = await startCapturingServer(requests);
    try {
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = server.endpoint;
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests).toHaveLength(1);

      // Second in-process call sets ONLY the off switch — nothing else of its own. It must not
      // reuse the first call's destination at all: no request goes out.
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '0';
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests).toHaveLength(1);

      // A third call that sets nothing of its own falls back to the (still off) settings the
      // second call captured, not the first call's now-discarded export configuration.
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests).toHaveLength(1);
    } finally {
      await server.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
