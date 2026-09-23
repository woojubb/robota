/** Public, provider-free stdio transport scenario. Run with --allowed or --denied. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'verify-mcp-stdio-'));
process.env['HOME'] = root;

const {
  createStdioAdapter,
  MCPActivationAdmissionService,
  MCPDefinitionRegistry,
  openMcpSession,
  MCPStdioError,
} = await import('../src/index.js');
const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

const fixturePath = fileURLToPath(new URL('./stdio-fixture-server.mjs', import.meta.url));
const definition = {
  name: 'stdio-example',
  source: 'project' as const,
  origin: 'example',
  transport: 'stdio' as const,
  command: process.execPath,
  args: [fixturePath, 'normal'],
  unsetVariables: [],
};
const entry = {
  name: definition.name,
  source: definition.source,
  origin: definition.origin,
  status: 'resolved' as const,
  definition,
  shadowed: [],
};
const service = new MCPActivationAdmissionService();
const [request] = new MCPDefinitionRegistry([entry], {
  workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 },
}).list();
if (request === undefined) throw new Error('scenario request missing');
const adapter = createStdioAdapter({
  admission: service,
  authority: {
    allowedRoot: root,
    generation: '1',
    executables: [{ command: process.execPath, args: [[fixturePath, 'normal']] }],
    environment: { HOME: root },
  },
});

try {
  const mode = process.argv.at(-1);
  if (mode === '--denied') {
    let starts = 0;
    const original = StdioClientTransport.prototype.start;
    StdioClientTransport.prototype.start = async function () {
      starts += 1;
      return original.call(this);
    };
    try {
      const rejected = await adapter.admit({
        definition,
        activation: {
          ...request,
          workspace: { repositoryKey: root, trustState: 'untrusted', generation: 1 },
        },
      });
      if (rejected.ok || starts !== 0 || JSON.stringify(rejected).includes(root)) {
        throw new Error('denied stdio definition crossed the process boundary');
      }
      process.stdout.write('result=denied; spawned=false; secretLeaked=false\n');
    } finally {
      StdioClientTransport.prototype.start = original;
    }
  } else if (mode === '--allowed') {
    service.approve(request);
    const result = await adapter.admit({ definition, activation: request });
    if (!result.ok) throw new Error(`stdio admission failed: ${result.reason}`);
    const transport = adapter.construct(result.admitted);
    const session = await openMcpSession({
      serverId: request.serverId,
      transport,
      timeouts: { startupMs: 5_000, perCallMs: 5_000 },
    });
    try {
      const discovery = await session.discover({ maxPages: 5, perRequestTimeoutMs: 5_000 });
      const called = await session.callTool('ping', {});
      if (
        discovery.tools.items.length !== 1 ||
        called.content[0]?.['text'] !== 'pong' ||
        !session.identity.protocolVersion ||
        !('pid' in transport) ||
        transport.pid === null
      ) {
        throw new Error('stdio discovery or call failed');
      }
    } finally {
      await session.close();
    }
    if (!('closedDirectChild' in transport) || transport.closedDirectChild !== true) {
      throw new MCPStdioError('cleanup');
    }
    process.stdout.write('result=called; discovered=true; spawned=true; shutdownClean=true\n');
  } else {
    throw new Error('Usage: verify-stdio-transport.ts --allowed|--denied');
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
