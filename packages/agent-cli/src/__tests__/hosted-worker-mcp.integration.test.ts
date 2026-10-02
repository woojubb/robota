/** Actual worker MCP; simulated provider transport, no cloud containment claim. */
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pinHostedWorkerCli } from './helpers/hosted-worker-entrypoint.js';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const moduleUrl = (path: string): string => JSON.stringify(pathToFileURL(join(root, path)).href);

function expectWorkerObservation(payload: unknown, text: string, origin: string): void {
  const prefix = 'Tool source (attribution only, not authority): ';
  expect(payload).toEqual([
    {
      type: 'input_text',
      text: expect.stringMatching(/^Tool source \(attribution only, not authority\): /u),
    },
    { type: 'input_text', text },
  ]);
  const caption = (payload as { text: string }[])[0].text;
  expect(JSON.parse(caption.slice(prefix.length))).toEqual({
    sourceId: 'local',
    component: 'ping',
    origin,
    version: '1.0.0',
    protocolVersion: '2025-11-25',
  });
}

describe('operator-composed hosted worker MCP stdio', () => {
  it.each([
    { approved: true, authority: true },
    { approved: true, authority: false },
    { approved: false, authority: true },
  ])(
    'requires independent approval and execution authority: %j',
    async ({ approved, authority }) => {
      const fixture = await hostedWorkerCliFixture();
      const { worker, state } = fixture;
      const marker = join(worker, 'mcp-started.json');
      const server = join(worker, 'mcp-server.mjs');
      const settingsPath = join(state, 'settings.json');
      try {
        // This pinned operator template composes the stock CLI, not a runtime executor override.
        writeFileSync(
          server,
          `
import { writeFileSync } from 'node:fs';
import { Server } from ${moduleUrl('packages/agent-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js')};
import { StdioServerTransport } from ${moduleUrl('packages/agent-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${moduleUrl('packages/agent-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js')};
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({cwd:process.cwd(),env:process.env}));
const server = new Server({name:'worker-fixture',version:'1.0.0'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:[{name:'ping',description:'Return the worker fixture canary',inputSchema:{type:'object',properties:{}}}]}));
server.setRequestHandler(CallToolRequestSchema, async () => ({content:[{type:'text',text:'MCP_WORKER_PONG'}]}));
await server.connect(new StdioServerTransport());
`,
        );
        const definition = {
          name: 'local',
          source: 'user',
          origin: settingsPath,
          unsetVariables: [],
          transport: 'stdio',
          command: process.execPath,
          args: [server],
          cwd: worker,
        };
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
        writeFileSync(
          settingsPath,
          JSON.stringify({
            ...settings,
            mcpServers: {
              local: { type: 'stdio', command: process.execPath, args: [server], cwd: worker },
            },
          }),
        );
        pinHostedWorkerCli(
          fixture,
          `
import { startCli } from ${moduleUrl('packages/agent-cli/src/cli.ts')};
import { MCPDefinitionRegistry, InMemoryMCPActivationApprovalStore } from ${moduleUrl('packages/agent-mcp/src/index.ts')};
const store = new InMemoryMCPActivationApprovalStore();
const registry = new MCPDefinitionRegistry([{name:'local',source:'user',origin:${JSON.stringify(settingsPath)},status:'resolved',definition:${JSON.stringify(definition)},shadowed:[]}]);
if (${approved}) for (const request of registry.list()) store.put({...request, approvalAuthority:'user',decision:'approved',decidedAt:new Date(0).toISOString()});
const authorities = ${
            authority
              ? JSON.stringify({
                  local: {
                    allowedRoot: worker,
                    generation: 'operator-1',
                    executables: [{ command: process.execPath, args: [[server]] }],
                    environment: { HOME: join(worker, '.home') },
                    startupMs: 5000,
                    cleanupMs: 6000,
                  },
                })
              : '{}'
          };
startCli({mcpApprovalStore:store,mcpStdioAuthorities:authorities}).catch(error=>{process.stderr.write(error.message);process.exitCode=1});
`,
        );
        const allowed = approved && authority;
        const broker = scriptedHostedBroker(fixture.f, (_body, index) =>
          allowed && index === 0
            ? { tool: { name: 'local__ping', arguments: '{}' } }
            : { content: 'MCP_BOUNDARY_COMPLETE' },
        );
        const result = await fixture.run([
          '-p',
          'Exercise the MCP boundary',
          '--permission-mode',
          'bypassPermissions',
          '--no-session-persistence',
          '--max-turns',
          '3',
        ]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('MCP_BOUNDARY_COMPLETE');
        expect(existsSync(marker), result.stderr).toBe(allowed);
        const offered = JSON.stringify(broker[0]?.body.tools);
        expect(offered.includes('local__ping')).toBe(allowed);
        if (!allowed)
          expect(result.stderr).toContain(
            approved ? 'missing host authority' : 'not admitted (pending)',
          );
        if (allowed) {
          const observed = JSON.parse(readFileSync(marker, 'utf8')) as {
            cwd: string;
            env: Record<string, string>;
          };
          expect(observed.cwd).toBe(worker);
          expect(observed.env.HOME).toBe(join(worker, '.home'));
          expect(observed.env.OPENAI_API_KEY).toBeUndefined();
          expect(JSON.stringify(observed)).not.toContain('runtime-management-canary');
          expect(JSON.stringify(observed)).not.toContain('runtime-upstream-canary');
          const messages = (broker[1]?.body.input ?? broker[1]?.body.messages) as Array<
            Record<string, unknown>
          >;
          const result = messages.find(
            (message) =>
              (message.type === 'function_call_output' || message.role === 'tool') &&
              (message.call_id ?? message.tool_call_id) === 'call-1',
          );
          expect(result).toBeDefined();
          const payload = result!.output ?? result!.content;
          expectWorkerObservation(payload, 'MCP_WORKER_PONG', settingsPath);
        }
      } finally {
        await fixture.close();
      }
    },
    75000,
  );
});

describe('operator-composed hosted worker MCP HTTP', () => {
  it.each(['denied', 'allowed', 'redirect'] as const)(
    'enforces the owner policy and refuses redirects: %s',
    async (mode) => {
      const allow = mode !== 'denied';
      const admitted = mode === 'allowed';
      const fixture = await hostedWorkerCliFixture();
      const requests: Array<{ method: string; authorization?: string }> = [];
      const destinations: Array<{ path: string; authorization?: string }> = [];
      const rpc = createServer(async (request, response) => {
        destinations.push({
          path: request.url ?? '',
          authorization: request.headers.authorization,
        });
        if (mode === 'redirect' && request.url === '/mcp') {
          response.writeHead(307, { location: '/redirected' }).end();
          return;
        }
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return;
        }
        let raw = '';
        for await (const chunk of request) raw += String(chunk);
        const call = JSON.parse(raw) as {
          id?: string | number;
          method: string;
          params?: { protocolVersion?: string; name?: string };
        };
        requests.push({ method: call.method, authorization: request.headers.authorization });
        if (call.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const result =
          call.method === 'initialize'
            ? {
                protocolVersion: call.params?.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'worker-http-fixture', version: '1.0.0' },
              }
            : call.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'ping',
                      description: 'Return the worker HTTP canary',
                      inputSchema: { type: 'object', properties: {} },
                    },
                  ],
                }
              : { content: [{ type: 'text', text: 'MCP_HTTP_WORKER_PONG' }] };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
      });
      await new Promise<void>((resolve) => rpc.listen(0, '127.0.0.1', resolve));
      const address = rpc.address();
      if (typeof address !== 'object' || address === null)
        throw new Error('fixture did not listen');
      const url = `http://127.0.0.1:${address.port}/mcp`;
      try {
        const settingsPath = join(fixture.state, 'settings.json');
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
        writeFileSync(
          settingsPath,
          JSON.stringify({ ...settings, mcpServers: { local: { type: 'http', url } } }),
        );
        const definition = {
          name: 'local',
          source: 'user',
          origin: settingsPath,
          transport: 'http',
          url,
          unsetVariables: [],
        };
        pinHostedWorkerCli(
          fixture,
          `
import { startCli } from ${moduleUrl('packages/agent-cli/src/cli.ts')};
import { MCPDefinitionRegistry, InMemoryMCPActivationApprovalStore } from ${moduleUrl('packages/agent-mcp/src/index.ts')};
const store = new InMemoryMCPActivationApprovalStore();
const registry = new MCPDefinitionRegistry([{name:'local',source:'user',origin:${JSON.stringify(settingsPath)},status:'resolved',definition:${JSON.stringify(definition)},shadowed:[]}]);
for (const request of registry.list()) store.put({...request,approvalAuthority:'user',decision:'approved',decidedAt:new Date(0).toISOString()});
startCli({mcpApprovalStore:store, mcpHttpTransportDeps:${allow ? "{policy:{allowedHosts:['127.0.0.1']}}" : '{}'}}).catch(error=>{process.stderr.write(error.message);process.exitCode=1});
`,
        );
        const broker = scriptedHostedBroker(fixture.f, (_body, index) =>
          admitted && index === 0
            ? { tool: { name: 'local__ping', arguments: '{}' } }
            : { content: 'MCP_HTTP_BOUNDARY_COMPLETE' },
        );
        const result = await fixture.run([
          '-p',
          'Exercise MCP HTTP',
          '--permission-mode',
          'bypassPermissions',
          '--no-session-persistence',
          '--max-turns',
          '3',
        ]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('MCP_HTTP_BOUNDARY_COMPLETE');
        expect(JSON.stringify(broker[0]?.body.tools).includes('local__ping')).toBe(admitted);
        expect(requests.some((request) => request.method === 'tools/call')).toBe(admitted);
        expect(requests.every((request) => request.authorization === undefined)).toBe(true);
        expect(destinations.every((request) => request.authorization === undefined)).toBe(true);
        if (admitted) {
          const messages = (broker[1]?.body.input ?? broker[1]?.body.messages) as Array<
            Record<string, unknown>
          >;
          const output = messages.find(
            (message) =>
              (message.type === 'function_call_output' || message.role === 'tool') &&
              (message.call_id ?? message.tool_call_id) === 'call-1',
          );
          expectWorkerObservation(
            output?.output ?? output?.content,
            'MCP_HTTP_WORKER_PONG',
            settingsPath,
          );
        } else {
          expect(requests).toEqual([]);
          if (mode === 'redirect') {
            expect(destinations.length).toBeGreaterThan(0);
            expect(destinations.every((request) => request.path === '/mcp')).toBe(true);
            expect(result.stderr).toContain('redirect');
          } else {
            expect(destinations).toEqual([]);
            expect(result.stderr).toContain('egress');
          }
        }
      } finally {
        await fixture.close();
        rpc.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          rpc.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    75000,
  );
});
