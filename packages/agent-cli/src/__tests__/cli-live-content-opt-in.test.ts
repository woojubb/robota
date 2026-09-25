import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startCli } from '../cli.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

const originalArgv = process.argv;
const originalHome = process.env.HOME;
const KEY_VARIABLE = 'ROBOTA_LIVE_CONTENT_TEST_KEY';
const API_KEY = 'content-test-api-key-9f8e7d';
let responseText = '';

const providerDefinition: IProviderDefinition = {
  type: 'livecontent-test',
  defaults: { model: 'test-model', apiKey: `$ENV:${KEY_VARIABLE}` },
  requiresApiKey: true,
  createProvider: (): IAIProvider => ({
    name: 'livecontent-test', version: 'test',
    async chat() {
      return { id: 'assistant-1', role: 'assistant', content: responseText, state: 'complete', timestamp: new Date() };
    },
    async generateResponse() { return { content: 'unused' }; },
    supportsTools: () => true,
    validateConfig: () => true,
  }),
};

describe('CLI live content opt-in', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    process.env.HOME = originalHome;
    delete process.env[KEY_VARIABLE];
    for (const key of Object.keys(process.env)) if (key.startsWith('ROBOTA_TELEMETRY_')) delete process.env[key];
  });

  it('sends no content without a gate, and refuses content gates outside the interactive terminal', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-cli-live-content-home-'));
    process.env.HOME = home;
    process.env[KEY_VARIABLE] = API_KEY;
    responseText = `the key is ${API_KEY}; notes are in ${home}/notes.txt`;
    vi.spyOn(process, 'cwd').mockReturnValue(home);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.argv = ['node', 'robota', '-p', 'what is in my notes', '--no-session-persistence'];

    const bodies: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      expect(request.url).toBe('/v1/logs');
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/x-protobuf' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const setTelemetry = (settings: Record<string, string>): void => {
        for (const [key, value] of Object.entries({
          ROBOTA_TELEMETRY_ENABLED: '1', ROBOTA_TELEMETRY_LOGS: 'otlp',
          ROBOTA_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf',
          ROBOTA_TELEMETRY_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`, ...settings,
        })) process.env[key] = value;
      };
      setTelemetry({});
      await expect(startCli({ providerDefinitions: [providerDefinition] })).rejects.toThrow('process.exit:0');
      expect(bodies).toHaveLength(1);
      expect(bodies.join('')).not.toMatch(/what is in my notes|the key is/u);

      // Only the interactive terminal records owner-typed prompts; print mode refuses content gates
      // instead of starting with them silently unused, and sends nothing.
      bodies.length = 0;
      const stderr = vi.mocked(process.stderr.write);
      stderr.mockClear();
      setTelemetry({ ROBOTA_TELEMETRY_LOG_USER_PROMPTS: '1', ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES: '1' });
      let error: unknown;
      try { await startCli({ providerDefinitions: [providerDefinition] }); } catch (caught) { error = caught; }
      const reported = `${error instanceof Error ? error.message : String(error)} ${stderr.mock.calls.join(' ')}`;
      expect(reported).toMatch(/content capture is available only in the interactive terminal, not in print mode/u);
      expect(reported).not.toContain(API_KEY);
      expect(bodies).toEqual([]);

      // Tool content gates start only where the owner types, too.
      for (const key of Object.keys(process.env)) if (key.startsWith('ROBOTA_TELEMETRY_')) delete process.env[key];
      stderr.mockClear();
      setTelemetry({ ROBOTA_TELEMETRY_LOG_TOOL_ARGUMENTS: '1', ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT: '1' });
      error = undefined;
      try { await startCli({ providerDefinitions: [providerDefinition] }); } catch (caught) { error = caught; }
      const toolReported = `${error instanceof Error ? error.message : String(error)} ${stderr.mock.calls.join(' ')}`;
      expect(toolReported).toMatch(/content capture is available only in the interactive terminal, not in print mode/u);
      expect(toolReported).not.toMatch(/not yet supported/u);
      expect(bodies).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      rmSync(home, { recursive: true, force: true });
    }
  });
});
