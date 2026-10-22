import { createInterface } from 'node:readline';

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const common = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
  const meta = request.params?._meta ?? {};
  let result;
  if (request.method === 'server/discover') {
    result = {
      ...common,
      supportedVersions: ['2026-07-28'],
      capabilities: {
        tools: {},
        resources: {},
        extensions: { 'io.modelcontextprotocol/ui': {} },
      },
    };
  } else if (request.method === 'tools/list') {
    result = {
      ...common,
      tools: [
        {
          name: 'show',
          inputSchema: { type: 'object', properties: {} },
          _meta: { ui: { resourceUri: 'ui://app/view' } },
        },
      ],
    };
  } else if (request.method === 'resources/list') {
    result = { ...common, resources: [] };
  } else if (request.params.uri === 'ui://app/fail') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32602, message: 'secret-from-server' },
      }) + '\n',
    );
    continue;
  } else {
    const declared = JSON.stringify(meta['io.modelcontextprotocol/clientCapabilities'] ?? null);
    result = {
      ...common,
      contents: [
        { uri: request.params.uri, mimeType: 'text/html;profile=mcp-app', text: declared },
      ],
    };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
