import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mode = process.argv[2] ?? 'normal';
if (mode === 'early-exit') process.exit(7);
if (mode === 'stall') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  const server = new Server(
    { name: 'stdio-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'ping', inputSchema: { type: 'object', properties: {} } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    if (mode === 'hang-call') {
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
      await new Promise(() => {});
    }
    return {
      content: [
        {
          type: 'text',
          text:
            mode === 'oversized-stdio'
              ? 'x'.repeat(9 * 1024 * 1024)
              : mode === 'client-info'
                ? JSON.stringify(server.getClientVersion())
                : 'pong',
        },
      ],
    };
  });
  if (mode === 'stderr') {
    process.stderr.write('secret-');
    process.stderr.write('fixture\n');
    process.stderr.write('x'.repeat(80_000));
  }
  await server.connect(new StdioServerTransport());
}
