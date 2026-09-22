/**
 * MCP-002 user-execution scenario — the shared client behind the admit-then-construct seam, TC-20.
 *
 * Run: `pnpm exec tsx examples/verify-mcp-client.ts` from `packages/agent-mcp`.
 *
 * Starts the repository's in-process mock MCP server on loopback, admits its URL through the
 * shared egress-policy seam (`createStreamableHttpAdapter`), opens a real MCP session over
 * Streamable HTTP through `MCPConnectionSupervisor`, discovers its tools across two pages, builds
 * the catalog, wraps the `echo` tool as a runtime tool via `createDiscoveredTool`, and calls it —
 * end to end, nothing mocked below the transport.
 */

import type { IMCPCatalogToolEntry } from '../src/index.js';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// HOME must be redirected before anything in this package (or a transitive import) gets a chance
// to read it. Nothing under `src/**` reads HOME today, but the scenario promises isolation, so the
// package's own value imports are deferred behind a dynamic import that runs only after this line
// — a static `import` of `../src/index.js` above this point would defeat the ordering entirely,
// since static imports are evaluated before any top-level statement in this module runs.
const tempHome = mkdtempSync(join(tmpdir(), 'verify-mcp-client-home-'));
process.env['HOME'] = tempHome;

const {
  createStreamableHttpAdapter,
  MCPConnectionSupervisor,
  openMcpSession,
  buildCatalog,
  createDiscoveredTool,
} = await import('../src/index.js');
const { startMockMcpServer, mockTools } = await import('../src/__tests__/mock-mcp-server.js');

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  const mock = await startMockMcpServer({ tools: mockTools(2), pageSize: 2 });

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
      timeouts: { startupMs: 5000, perCallMs: 5000, globalDefaultMs: 5000, idleMs: 60000 },
    });

    try {
      const discovery = await supervisor.discover();
      assertCondition(
        discovery.tools.items.length === 3,
        `discovered ${discovery.tools.items.length} tools, expected 3 (pagination did not drain both pages)`,
      );

      const catalog = buildCatalog([
        {
          serverId: 'mock-mcp',
          origin: 'examples/verify-mcp-client.ts',
          transport: 'streamable-http',
          discovery,
        },
      ]);

      const entry = [...catalog.adopted, ...catalog.adapted].find(
        (candidate): candidate is IMCPCatalogToolEntry =>
          candidate.kind === 'tool' && candidate.sourceName === 'echo',
      );
      assertCondition(entry !== undefined, 'the echo tool did not survive catalog build');
      assertCondition(
        entry.canonicalName === 'mock-mcp__echo',
        `echo's canonical name was "${entry.canonicalName}", expected "mock-mcp__echo"`,
      );

      const tool = createDiscoveredTool(entry, supervisor);
      const result = await tool.execute(
        { text: 'hello' },
        { toolName: entry.canonicalName, parameters: { text: 'hello' } },
      );
      assertCondition(
        result.success === true,
        `tool call did not succeed: ${JSON.stringify(result)}`,
      );

      process.stdout.write(
        `result=transport=streamable-http; discoveredTools=${discovery.tools.items.length}; ` +
          `invoked=${entry.canonicalName}; catalogSource=${entry.provenance.serverId}\n`,
      );
    } finally {
      await supervisor.shutdown();
    }
  } finally {
    await mock.close();
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
