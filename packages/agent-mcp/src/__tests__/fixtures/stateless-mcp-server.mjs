import { createInterface } from 'node:readline';

const methods = [];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const metadata = request.params?._meta;
  if (
    metadata?.['io.modelcontextprotocol/protocolVersion'] !== '2026-07-28' ||
    metadata?.['io.modelcontextprotocol/clientCapabilities'] === undefined ||
    request.method === 'initialize'
  ) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32600, message: 'Invalid stateless request' },
      }) + '\n',
    );
    continue;
  }
  methods.push(request.method);
  const common = {
    resultType: 'complete',
    ttlMs: 0,
    cacheScope: 'private',
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'stdio-stateless', version: '1' } },
  };
  const result =
    request.method === 'server/discover'
      ? { ...common, supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
      : request.method === 'tools/list'
        ? { ...common, tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
        : { ...common, content: [{ type: 'text', text: methods.join(',') }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
