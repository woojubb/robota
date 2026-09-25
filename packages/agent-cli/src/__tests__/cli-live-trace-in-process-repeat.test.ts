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
  'ROBOTA_TELEMETRY_ENABLED', 'ROBOTA_TELEMETRY_TRACES',
  'ROBOTA_TELEMETRY_OTLP_PROTOCOL', 'ROBOTA_TELEMETRY_OTLP_ENDPOINT',
] as const;
const originalTelemetry = Object.fromEntries(telemetryKeys.map((key) => [key, process.env[key]]));

const providerDefinition: IProviderDefinition = {
  type: 'livetrace-repeat-test',
  defaults: { model: 'test-model', apiKey: '$ENV:ROBOTA_LIVE_TRACE_TEST_KEY' },
  requiresApiKey: true,
  createProvider: (): IAIProvider => ({
    name: 'livetrace-repeat-test', version: 'test',
    async chat() {
      return { id: 'assistant-1', role: 'assistant', content: 'private response',
        state: 'complete', timestamp: new Date() };
    },
    async generateResponse() { return { content: 'unused' }; },
    supportsTools: () => true,
    validateConfig: () => true,
  }),
};

describe('CLI live trace across a second in-process startCli', () => {
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

  it('exports from a second in-process startCli even though the first already stripped process.env', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-cli-live-trace-repeat-home-'));
    process.env.HOME = home;
    process.env['ROBOTA_LIVE_TRACE_TEST_KEY'] = 'test-only-key';
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'robota', '-p', 'private prompt', '--no-session-persistence'];

    const requests: Array<{ path: string }> = [];
    const server = createServer(async (request, response) => {
      requests.push({ path: request.url ?? '' });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const endpoint = `http://127.0.0.1:${address.port}`;

      // Telemetry is configured only once, before the FIRST in-process startCli. Nothing re-sets it
      // before the second call — the first call strips these from process.env as its first step, so
      // without a retained snapshot the second call would silently run with telemetry off.
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = endpoint;

      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests.map((request) => request.path)).toEqual(['/v1/traces']);
      expect(Object.keys(process.env).filter((key) => key.startsWith('ROBOTA_TELEMETRY_'))).toEqual([]);

      // Second in-process call, same process, nothing re-set: it must still export, from the
      // settings the first call captured — not silently run with no telemetry.
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests.map((request) => request.path)).toEqual(['/v1/traces', '/v1/traces']);
      expect(Object.keys(process.env).filter((key) => key.startsWith('ROBOTA_TELEMETRY_'))).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(home, { recursive: true, force: true });
    }
  });
});
