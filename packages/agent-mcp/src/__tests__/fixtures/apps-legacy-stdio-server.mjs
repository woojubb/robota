import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const server = new Server(
  { name: 'apps-legacy-stdio', version: '1.0.0' },
  {
    capabilities: {
      tools: {},
      resources: {},
      extensions: { 'io.modelcontextprotocol/ui': {} },
    },
  },
);
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'show',
      inputSchema: { type: 'object', properties: {} },
      _meta: { ui: { resourceUri: 'ui://app/view' } },
    },
  ],
}));
server.setRequestHandler('resources/list', async () => ({ resources: [] }));
server.setRequestHandler('resources/read', async (request) => {
  if (request.params.uri === 'ui://app/fail') throw new Error('secret-from-server');
  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: 'text/html;profile=mcp-app',
        // The document echoes the client capabilities the initialize declared.
        text: JSON.stringify(server.getClientCapabilities() ?? null),
      },
    ],
  };
});
await server.connect(new StdioServerTransport());
