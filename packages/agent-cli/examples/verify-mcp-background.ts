/**
 * MCP-004 user-execution scenario (TC-14): a slow MCP tool call is handed to a REAL background
 * task, end to end — the real `BackgroundTaskManager` + `createDefaultBackgroundTaskRunners()`'s
 * `tool-invocation` runner, the real `agent-mcp` client stack (admission → supervisor → catalog →
 * discovered tool) against an in-process mock MCP server, and the real `InteractiveSession` with
 * `toolCallHandoff` set — nothing about the handoff itself is mocked.
 *
 * Run: `pnpm scenario:verify:mcp-background` from `packages/agent-cli`.
 *
 * `HOME` is redirected to an isolated temp directory before anything in this package (or a
 * transitive import) gets a chance to read it — this scenario never touches the real `~/.robota`.
 * A static `import` of framework/executor/mcp modules above that reassignment would defeat the
 * ordering (static imports evaluate before any top-level statement runs), so those imports are
 * deferred behind a dynamic `import()`, exactly as `agent-mcp`'s own
 * `examples/verify-mcp-client.ts` does for the same reason.
 */

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

const tempHome = mkdtempSync(join(tmpdir(), 'verify-mcp-background-home-'));
process.env['HOME'] = tempHome;

const { createScriptedProvider } = await import('@robota-sdk/agent-core/testing');
const { InteractiveSession } = await import('@robota-sdk/agent-framework');
const { createDefaultBackgroundTaskRunners } = await import('@robota-sdk/agent-executor');
const {
  createStreamableHttpAdapter,
  MCPConnectionSupervisor,
  openMcpSession,
  buildCatalog,
  createDiscoveredTool,
} = await import('@robota-sdk/agent-mcp');

import type { IMCPCatalogToolEntry } from '@robota-sdk/agent-mcp';

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── A minimal, self-contained mock MCP server (Streamable HTTP) ────────────────────────────────
//
// Not a reuse of `@robota-sdk/agent-mcp`'s own `src/__tests__/mock-mcp-server.ts`: that file is
// private to that package (no `exports` subpath), and this package's boundary scan does not permit
// a source-level reach across a package's `src/__tests__` — so this scenario speaks the small
// request/response subset `MCPConnectionSupervisor` actually drives (`initialize`,
// `notifications/initialized`, `tools/list`, `tools/call`) itself.

const SLOW_TOOL_NAME = 'slow_tool';
const JSON_RPC_METHOD_NOT_FOUND = -32601;

interface IMiniMcpServer {
  readonly url: string;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
  });
}

async function startSlowToolMcpServer(delayMs: number): Promise<IMiniMcpServer> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (req.method === 'DELETE') {
        res.writeHead(204).end();
        return;
      }
      const raw = await readBody(req);
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        body = undefined;
      }
      const method = body?.['method'];
      const id = body?.['id'] as string | number | undefined;

      if (method === 'initialize') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'mock-mcp-background', version: '1.0.0' },
            },
          }),
        );
        return;
      }
      if (method === 'notifications/initialized') {
        res.writeHead(202).end();
        return;
      }
      if (method === 'tools/list') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              tools: [
                {
                  name: SLOW_TOOL_NAME,
                  description: 'A tool that answers slowly, for exercising the handoff threshold.',
                  inputSchema: { type: 'object', properties: {}, required: [] },
                },
              ],
            },
          }),
        );
        return;
      }
      if (method === 'tools/call') {
        // The configurable delay this scenario hands off on: comfortably above the wrapper's
        // `thresholdMs`, comfortably below the supervisor's `toolCallMs` budget.
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: 'slow tool done' }], isError: false },
            }),
          );
        }, delayMs);
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: id ?? null,
          error: { code: JSON_RPC_METHOD_NOT_FOUND, message: `Unknown method: ${String(method)}` },
        }),
      );
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('mock MCP server failed to bind a port');
  }
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ── Reading `background_task_event` without a static import of its type ────────────────────────
//
// `@robota-sdk/agent-interface-execution` is not a declared dependency of this package (INFRA-028:
// `agent-cli` bundles its @robota-sdk closure and keeps the dependency lists to what is actually
// imported). The event's shape is read structurally instead of adding a dependency for one type.

interface IScenarioBackgroundTask {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
}

function taskOf(event: unknown): IScenarioBackgroundTask | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const task = (event as Record<string, unknown>)['task'];
  if (typeof task !== 'object' || task === null) return undefined;
  const { id, kind, status } = task as Record<string, unknown>;
  if (typeof id !== 'string' || typeof kind !== 'string' || typeof status !== 'string') {
    return undefined;
  }
  return { id, kind, status };
}

function typeOf(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const type = (event as Record<string, unknown>)['type'];
  return typeof type === 'string' ? type : undefined;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── The scenario ─────────────────────────────────────────────────────────────────────────────

const THRESHOLD_MS = 200;
const TOOL_DELAY_MS = 600;
const BUDGET_MS = 5000;

async function run(): Promise<void> {
  const mock = await startSlowToolMcpServer(TOOL_DELAY_MS);
  const workspaceDir = mkdtempSync(join(tmpdir(), 'verify-mcp-background-cwd-'));

  try {
    const adapter = createStreamableHttpAdapter({
      lookup: async () => ['127.0.0.1'],
      policy: { allowedHosts: ['127.0.0.1'] },
    });
    const admission = await adapter.admit({ url: mock.url });
    if (!admission.ok) {
      throw new Error(`adapter refused the mock endpoint: ${admission.message}`);
    }
    const admitted = admission.admitted;

    const supervisor = new MCPConnectionSupervisor({
      serverId: 'mock-mcp',
      openSession: (signal) =>
        openMcpSession({
          serverId: 'mock-mcp',
          transport: adapter.construct(admitted),
          timeouts: { startupMs: 5000, perCallMs: 5000 },
          signal,
        }),
      // S2: the supervisor's OWN `toolCallMs` is the one enforcer of the call's actual budget — set
      // well above `TOOL_DELAY_MS` so the handoff (not a supervisor timeout) is what this proves.
      timeouts: {
        startupMs: 5000,
        perCallMs: 5000,
        globalDefaultMs: 5000,
        idleMs: 60000,
        toolCallMs: BUDGET_MS,
      },
    });

    try {
      const discovery = await supervisor.discover();
      const catalog = buildCatalog([
        {
          serverId: 'mock-mcp',
          origin: 'examples/verify-mcp-background.ts',
          transport: 'streamable-http',
          discovery,
        },
      ]);
      const entry = [...catalog.adopted, ...catalog.adapted].find(
        (candidate): candidate is IMCPCatalogToolEntry =>
          candidate.kind === 'tool' && candidate.sourceName === SLOW_TOOL_NAME,
      );
      assertCondition(entry !== undefined, 'the slow tool did not survive catalog build');
      const discoveredTool = createDiscoveredTool(entry, supervisor);
      const canonicalName = discoveredTool.getName();

      const scripted = createScriptedProvider([
        { toolCalls: [{ name: canonicalName, args: {} }] },
        { text: 'the slow tool call was handed off; nothing left to do' },
      ]);

      const session = new InteractiveSession({
        cwd: workspaceDir,
        provider: scripted.provider,
        bare: true,
        permissionMode: 'bypassPermissions',
        additionalTools: [discoveredTool],
        backgroundTaskRunners: createDefaultBackgroundTaskRunners(),
        toolCallHandoff: {
          thresholdMs: THRESHOLD_MS,
          budgetMs: BUDGET_MS,
          toolNames: [canonicalName],
          provenance: {
            [canonicalName]: {
              serverId: 'mock-mcp',
              sourceName: entry.sourceName,
              securityIdentity: 'verify-mcp-background-scenario',
              permissionMode: 'bypassPermissions',
            },
          },
        },
        maxTurns: 4,
      });

      const events: unknown[] = [];
      session.on('background_task_event', (event: unknown) => {
        events.push(event);
      });

      try {
        const handle = await session.submit('call the slow tool');
        await handle.completed;

        await waitUntil(
          () =>
            events.some(
              (event) =>
                typeOf(event) === 'background_task_completed' && taskOf(event) !== undefined,
            ),
          BUDGET_MS,
          'timed out waiting for background_task_completed',
        );

        const created = events.filter(
          (event) =>
            typeOf(event) === 'background_task_created' &&
            taskOf(event)?.kind === 'tool-invocation',
        );
        assertCondition(
          created.length === 1,
          `expected exactly one tool-invocation background_task_created event, got ${created.length}`,
        );
        const taskId = taskOf(created[0])?.id;
        assertCondition(taskId !== undefined, 'created event carried no task id');

        const completed = events.filter(
          (event) => typeOf(event) === 'background_task_completed' && taskOf(event)?.id === taskId,
        );
        assertCondition(
          completed.length === 1,
          `expected exactly one completion for task ${taskId}, got ${completed.length}`,
        );
        const finalStatus = taskOf(completed[0])?.status;
        assertCondition(
          finalStatus === 'completed',
          `expected status 'completed' for task ${taskId}, got '${String(finalStatus)}'`,
        );

        process.stdout.write(
          `result=handoff=background-task; taskId=${taskId}; completion=notified-once; status=${finalStatus}\n`,
        );
      } finally {
        await session.shutdown();
      }
    } finally {
      await supervisor.shutdown();
    }
  } finally {
    await mock.close();
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    rmSync(tempHome, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((error: unknown) => {
    rmSync(tempHome, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`failure=${message}\n`);
    process.exit(1);
  });
