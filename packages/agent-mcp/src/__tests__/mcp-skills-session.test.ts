import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { openMcpSession, type IMCPSession } from '../client/session.js';
import { admitHttpEndpoint, constructStreamableHttpTransport } from '../client/transport.js';

const content =
  '---\nname: demo\ndescription: Use a verified demo workflow\nallowed-tools: Read\n---\nInstructions.\n';
const uri = 'skill://team/demo/SKILL.md';
const entry = () => ({
  uri,
  frontmatter: {
    name: 'demo',
    description: 'Use a verified demo workflow',
    'allowed-tools': 'Read',
  },
  resources: [
    {
      uri,
      size: Buffer.byteLength(content),
      digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    },
  ],
});
const methods: string[] = [];
let listener: ReturnType<typeof createServer> | undefined;
let session: IMCPSession | undefined;

async function fixture(
  enabled: boolean,
  alter: (method: string, result: Record<string, unknown>) => Record<string, unknown> = (
    _method,
    result,
  ) => result,
  rawContent = content,
) {
  listener = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const message = JSON.parse(text);
    methods.push(message.method);
    expect(message.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    const base = { resultType: 'complete', ttlMs: 0, cacheScope: 'private' };
    const result =
      message.method === 'server/discover'
        ? {
            ...base,
            supportedVersions: ['2026-07-28'],
            capabilities: { resources: {}, extensions: { 'io.modelcontextprotocol/skills': {} } },
          }
        : message.method === 'skills/list'
          ? { ...base, skills: [entry()] }
          : message.method === 'skills/get'
            ? { ...base, skill: entry() }
            : {
                ...base,
                contents: [
                  { uri: message.params.uri, text: rawContent, mimeType: 'text/markdown' },
                ],
              };
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ jsonrpc: '2.0', id: message.id, result: alter(message.method, result) }),
    );
  });
  await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', resolve));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  const admitted = await admitHttpEndpoint(
    { url: `http://127.0.0.1:${address.port}` },
    { policy: { allowedHosts: ['127.0.0.1'] } },
  );
  if (!admitted.ok) throw new Error(admitted.reason);
  const options = {
    serverId: 'fixture',
    protocolVersion: '2026-07-28',
    skills: enabled,
    transport: constructStreamableHttpTransport(admitted.admitted),
    timeouts: { startupMs: 5000, perCallMs: 5000 },
  };
  session = await openMcpSession(options);
  return session;
}

afterEach(async () => {
  await session?.close();
  session = undefined;
  await new Promise<void>((resolve) => (listener ? listener.close(() => resolve()) : resolve()));
  listener = undefined;
  methods.length = 0;
});

it('keeps the advertised extension inactive until the host opts in', async () => {
  const client = await fixture(false);
  expect(client.skills).toBeUndefined();
  expect(methods).toEqual(['server/discover']);
});

it('lazily lists complete server-scoped manifests and verifies only a requested file', async () => {
  const client = await fixture(true);
  expect(client.skills).toBeDefined();
  const entries = await client.skills!.list({ maxPages: 2 });
  expect(methods).toEqual(['server/discover', 'skills/list']);
  expect(entries[0]).toMatchObject({
    uri,
    identity: { serverId: 'fixture' },
    frontmatter: entry().frontmatter,
  });
  expect(await client.skills!.read(entries[0]!, uri)).toMatchObject({
    text: content,
    size: Buffer.byteLength(content),
  });
  expect(methods).toEqual(['server/discover', 'skills/list', 'resources/read']);
});

it('supports explicit URI discovery after an empty listing and invalidates changed manifests', async () => {
  let changed = false;
  const client = await fixture(true, (method, result) => {
    if (method === 'skills/list') return { ...result, skills: [] };
    if (method === 'skills/get' && changed)
      return {
        ...result,
        skill: {
          ...entry(),
          frontmatter: { ...entry().frontmatter, description: 'Changed workflow' },
        },
      };
    return result;
  });
  expect(client.skills).toBeDefined();
  expect(await client.skills!.list({ maxPages: 1 })).toEqual([]);
  const first = await client.skills!.get(uri);
  changed = true;
  await client.skills!.get(uri);
  await expect(client.skills!.read(first, uri)).rejects.toMatchObject({
    reason: 'changed-manifest',
  });
  expect(methods.filter((method) => method === 'resources/read')).toHaveLength(0);
});

it('refuses changed bytes and removes the observed manifest without exposing the bytes', async () => {
  const client = await fixture(true, (method, result) =>
    method === 'resources/read'
      ? { ...result, contents: [{ uri, text: 'credential-canary' }] }
      : result,
  );
  expect(client.skills).toBeDefined();
  const skill = await client.skills!.get(uri);
  const error = await client.skills!.read(skill, uri).catch((error) => error);
  expect(error.message).not.toContain('credential-canary');
  expect(error.reason).toBe('size-mismatch');
  await expect(client.skills!.read(skill, uri)).rejects.toMatchObject({
    reason: 'changed-manifest',
  });
  expect(methods.filter((method) => method === 'resources/read')).toHaveLength(1);
});

it('supports the full 16 MiB raw manifest budget even when JSON escaping is larger', async () => {
  const largeContent = '\u0001'.repeat(16 * 1024 * 1024);
  const largeEntry = {
    ...entry(),
    resources: [
      {
        uri,
        size: Buffer.byteLength(largeContent),
        digest: `sha256:${createHash('sha256').update(largeContent).digest('hex')}`,
      },
    ],
  };
  const client = await fixture(
    true,
    (method, result) => (method === 'skills/get' ? { ...result, skill: largeEntry } : result),
    largeContent,
  );
  const skill = await client.skills!.get(uri);
  expect((await client.skills!.read(skill, uri)).text).toBe(largeContent);
}, 15_000);

it('invalidates the old manifest when a refresh returns an invalid replacement', async () => {
  let invalid = false;
  const client = await fixture(true, (method, result) =>
    method === 'skills/get' && invalid
      ? { ...result, skill: { ...entry(), resources: [] } }
      : result,
  );
  const skill = await client.skills!.get(uri);
  invalid = true;
  await expect(client.skills!.get(uri)).rejects.toMatchObject({ reason: 'invalid-manifest' });
  await expect(client.skills!.read(skill, uri)).rejects.toMatchObject({
    reason: 'changed-manifest',
  });
  expect(methods.filter((method) => method === 'resources/read')).toHaveLength(0);
});

it('keeps metadata responses under the ordinary receive limit even when Skills is enabled', async () => {
  const client = await fixture(true, (method, result) =>
    method === 'skills/get' ? { ...result, unrelated: 'x'.repeat(9 * 1024 * 1024) } : result,
  );
  await expect(client.skills!.get(uri)).rejects.toThrow(/receive byte limit/);
});

it.each([
  { resources: {} },
  { extensions: { 'io.modelcontextprotocol/skills': {} } },
  { resources: {}, extensions: { 'io.modelcontextprotocol/skills': { directoryRead: 'true' } } },
])(
  'refuses unavailable or malformed extension declarations without sending extension requests: %j',
  async (capabilities) => {
    const client = await fixture(true, (method, result) =>
      method === 'server/discover' ? { ...result, capabilities } : result,
    );
    expect(client.skills).toBeUndefined();
    expect(client.compatibilityDiagnostics).toContainEqual(
      expect.objectContaining({ capability: 'skills' }),
    );
    expect(methods).toEqual(['server/discover']);
  },
);

it.each(['YQ', 'YQ==\n'])(
  'accepts valid standard resource Base64 %j and verifies its decoded bytes',
  async (blob) => {
    const binaryEntry = {
      ...entry(),
      resources: [
        { uri, size: 1, digest: `sha256:${createHash('sha256').update('a').digest('hex')}` },
      ],
    };
    const client = await fixture(true, (method, result) =>
      method === 'skills/get'
        ? { ...result, skill: binaryEntry }
        : method === 'resources/read'
          ? { ...result, contents: [{ uri, blob }] }
          : result,
    );
    const skill = await client.skills!.get(uri);
    expect(await client.skills!.read(skill, uri)).toMatchObject({
      blob,
      size: 1,
      digest: binaryEntry.resources[0]!.digest,
    });
  },
);
