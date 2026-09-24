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
  'ROBOTA_TELEMETRY_METRICS', 'ROBOTA_TELEMETRY_LOGS',
  'ROBOTA_TELEMETRY_OTLP_PROTOCOL', 'ROBOTA_TELEMETRY_OTLP_ENDPOINT',
  'ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT', 'ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT',
  'ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT',
] as const;
const originalTelemetry = Object.fromEntries(telemetryKeys.map((key) => [key, process.env[key]]));

const providerDefinition: IProviderDefinition = {
  type: 'livetrace-test',
  defaults: { model: 'test-model', apiKey: '$ENV:ROBOTA_LIVE_TRACE_TEST_KEY' },
  requiresApiKey: true,
  createProvider: (): IAIProvider => ({
    name: 'livetrace-test', version: 'test',
    async chat() {
      return { id: 'assistant-1', role: 'assistant', content: 'private response',
        state: 'complete', timestamp: new Date() };
    },
    async generateResponse() { return { content: 'unused' }; },
    supportsTools: () => true,
    validateConfig: () => true,
  }),
};

describe('CLI live trace opt-in', () => {
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

  it('sends no telemetry when off, then independently selected live traces, metrics or logs in print mode', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-cli-live-trace-home-'));
    process.env.HOME = home;
    delete process.env['ROBOTA_TELEMETRY_OTLP_TRACES_ENDPOINT'];
    delete process.env['ROBOTA_TELEMETRY_METRICS'];
    delete process.env['ROBOTA_TELEMETRY_OTLP_METRICS_ENDPOINT'];
    delete process.env['ROBOTA_TELEMETRY_LOGS'];
    delete process.env['ROBOTA_TELEMETRY_OTLP_LOGS_ENDPOINT'];
    process.env['ROBOTA_LIVE_TRACE_TEST_KEY'] = 'test-only-key';
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'robota', '-p', 'private prompt', '--no-session-persistence'];

    const requests: Array<{ path: string; body: string }> = [];
    const server = createServer(async (request, response) => {
      expect(request.headers['content-type']).toBe('application/x-protobuf');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({ path: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const endpoint = `http://127.0.0.1:${address.port}`;
      process.env['ROBOTA_TELEMETRY_ENABLED'] = '0';
      process.env['ROBOTA_TELEMETRY_TRACES'] = 'otlp';
      process.env['ROBOTA_TELEMETRY_OTLP_PROTOCOL'] = 'http/protobuf';
      process.env['ROBOTA_TELEMETRY_OTLP_ENDPOINT'] = endpoint;
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests).toEqual([]);

      process.env['ROBOTA_TELEMETRY_ENABLED'] = '1';
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests.map((request) => request.path)).toEqual(['/v1/traces']);
      expect(requests[0]!.body).toContain('service.version');
      expect(requests[0]!.body).toContain('robota.surface');
      expect(requests[0]!.body).toContain('print');

      process.env['ROBOTA_TELEMETRY_TRACES'] = 'off';
      process.env['ROBOTA_TELEMETRY_METRICS'] = 'otlp';
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests.map((request) => request.path)).toEqual(['/v1/traces', '/v1/metrics']);

      process.env['ROBOTA_TELEMETRY_METRICS'] = 'off';
      process.env['ROBOTA_TELEMETRY_LOGS'] = 'otlp';
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(requests.map((request) => request.path)).toEqual(['/v1/traces', '/v1/metrics', '/v1/logs']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(home, { recursive: true, force: true });
    }
  });
});
