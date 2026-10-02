import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const uri = 'skill://binary-demo/SKILL.md';
const bytes = Buffer.alloc(16 * 1024 * 1024, 42);
const skill = {
  uri,
  frontmatter: { name: 'binary-demo', description: 'Read the verified binary fixture' },
  resources: [
    {
      uri,
      size: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    },
  ],
};
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const common = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
  const result =
    request.method === 'server/discover'
      ? {
          ...common,
          supportedVersions: ['2026-07-28'],
          capabilities: { resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
        }
      : request.method === 'skills/get'
        ? { ...common, skill }
        : { ...common, contents: [{ uri, blob: bytes.toString('base64') }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
