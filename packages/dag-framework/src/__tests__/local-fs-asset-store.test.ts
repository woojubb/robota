import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFsAssetStore } from '../adapters/local-fs-asset-store.js';

/**
 * The network the SSRF tests see. `answers` is the resolver's table (a list per call, the last one
 * repeating); `publicStandIn` is the one address the classifier treats as public, so a test can reach
 * a local server as if it were a public host. Unset, every loopback address is private as in production.
 */
const net = vi.hoisted(() => ({
  answers: new Map<string, string[][]>(),
  lookups: [] as string[],
  publicStandIn: undefined as string | undefined,
}));

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  const lookup = (
    hostname: string,
    options: { all?: boolean },
    callback: (err: Error | null, address: unknown, family?: number) => void,
  ): void => {
    net.lookups.push(hostname);
    const calls = net.answers.get(hostname);
    const answer = calls?.length === 1 ? calls[0] : calls?.shift();
    if (answer === undefined) {
      callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }), '');
      return;
    }
    const entries = answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    if (options.all === true) callback(null, entries);
    else callback(null, entries[0]?.address, entries[0]?.family);
  };
  return { ...actual, lookup };
});

vi.mock('@robota-sdk/agent-core/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core/node')>();
  return {
    ...actual,
    isPrivateAddress: (ip: string) => ip !== net.publicStandIn && actual.isPrivateAddress(ip),
  };
});

let tmpDir: string;
let store: LocalFsAssetStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dag-asset-store-test-'));
  store = new LocalFsAssetStore(tmpDir);
  await store.initialize();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('LocalFsAssetStore.initialize', () => {
  it('creates the root directory if it does not exist', async () => {
    const newDir = path.join(tmpDir, 'new-subdir');
    const freshStore = new LocalFsAssetStore(newDir);
    await freshStore.initialize();
    const { existsSync } = await import('node:fs');
    expect(existsSync(newDir)).toBe(true);
  });

  it('does not throw when directory already exists', async () => {
    await expect(store.initialize()).resolves.not.toThrow();
  });
});

describe('LocalFsAssetStore.save', () => {
  it('saves binary content and returns metadata with assetId', async () => {
    const content = Buffer.from('hello binary content');
    const metadata = await store.save({
      fileName: 'test.bin',
      mediaType: 'application/octet-stream',
      content,
    });

    expect(typeof metadata.assetId).toBe('string');
    expect(metadata.assetId.length).toBeGreaterThan(0);
    expect(metadata.fileName).toBe('test.bin');
    expect(metadata.mediaType).toBe('application/octet-stream');
    expect(metadata.sizeBytes).toBe(content.byteLength);
    expect(typeof metadata.createdAt).toBe('string');
  });

  it('writes a .bin file and .json metadata sidecar to disk', async () => {
    const content = Buffer.from('data');
    const metadata = await store.save({
      fileName: 'data.bin',
      mediaType: 'application/octet-stream',
      content,
    });

    const binPath = path.join(tmpDir, `${metadata.assetId}.bin`);
    const jsonPath = path.join(tmpDir, `${metadata.assetId}.json`);

    const savedBin = await readFile(binPath);
    expect(savedBin.equals(content)).toBe(true);

    const savedMeta = JSON.parse(await readFile(jsonPath, 'utf-8')) as { assetId: string };
    expect(savedMeta.assetId).toBe(metadata.assetId);
  });

  it('includes runtimeAssetId when provided', async () => {
    const metadata = await store.save({
      fileName: 'img.png',
      mediaType: 'image/png',
      content: Buffer.from([1, 2, 3]),
      runtimeAssetId: 'runtime-xyz',
    });
    expect(metadata.runtimeAssetId).toBe('runtime-xyz');
  });
});

describe('LocalFsAssetStore.saveReference', () => {
  it('saves only metadata (no binary file) and returns metadata', async () => {
    const metadata = await store.saveReference({
      fileName: 'remote.jpg',
      mediaType: 'image/jpeg',
      sourceUri: 'https://example.com/image.jpg',
      binaryKind: 'image',
      sizeBytes: 1024,
    });

    expect(typeof metadata.assetId).toBe('string');
    expect(metadata.sourceUri).toBe('https://example.com/image.jpg');
    expect(metadata.sizeBytes).toBe(1024);
    expect(metadata.binaryKind).toBe('image');

    const binPath = path.join(tmpDir, `${metadata.assetId}.bin`);
    const { existsSync } = await import('node:fs');
    expect(existsSync(binPath)).toBe(false);
  });

  it('uses 0 as sizeBytes when not provided', async () => {
    const metadata = await store.saveReference({
      fileName: 'audio.mp3',
      mediaType: 'audio/mpeg',
      sourceUri: 'https://example.com/audio.mp3',
      binaryKind: 'audio',
    });
    expect(metadata.sizeBytes).toBe(0);
  });
});

describe('LocalFsAssetStore.getMetadata', () => {
  it('returns undefined for unknown assetId', async () => {
    const result = await store.getMetadata('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('returns metadata for a saved asset', async () => {
    const saved = await store.save({
      fileName: 'file.txt',
      mediaType: 'text/plain',
      content: Buffer.from('content'),
    });

    const retrieved = await store.getMetadata(saved.assetId);
    expect(retrieved).not.toBeUndefined();
    expect(retrieved?.assetId).toBe(saved.assetId);
    expect(retrieved?.fileName).toBe('file.txt');
  });
});

describe('LocalFsAssetStore.getContent', () => {
  it('returns undefined for unknown assetId', async () => {
    const result = await store.getContent('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('returns a readable stream for a saved binary asset', async () => {
    const content = Buffer.from('stream me');
    const saved = await store.save({
      fileName: 'streamable.bin',
      mediaType: 'application/octet-stream',
      content,
    });

    const result = await store.getContent(saved.assetId);
    expect(result).not.toBeUndefined();
    expect(result?.metadata.assetId).toBe(saved.assetId);

    const chunks: Uint8Array[] = [];
    for await (const chunk of result!.stream) {
      chunks.push(chunk);
    }
    const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(combined.equals(content)).toBe(true);
  });
});

/**
 * SSRF guard. `sourceUri` is attacker-influenceable: it is whatever URI an upstream DAG node emitted
 * (`asset-aware-executor` persists `value.uri`), so dereferencing it unguarded would let a task
 * executor read cloud-metadata credentials, loopback admin ports, or local files through this store.
 */
describe('LocalFsAssetStore.getContent SSRF guard', () => {
  let server: Server;
  let port: number;
  let hits: string[];
  let respond: (url: string) => { status: number; headers?: Record<string, string>; body?: string };

  beforeEach(async () => {
    hits = [];
    respond = () => ({ status: 200, body: 'remote payload' });
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      const { status, headers, body } = respond(req.url ?? '');
      res.writeHead(status, headers);
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    net.answers.clear();
    net.lookups = [];
    net.publicStandIn = undefined;
    vi.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function saveRef(sourceUri: string): Promise<string> {
    const metadata = await store.saveReference({
      fileName: 'ref.bin',
      mediaType: 'application/octet-stream',
      sourceUri,
      binaryKind: 'file',
    });
    return metadata.assetId;
  }

  async function drain(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }

  /** `name` resolves to the local server, which the classifier treats as a public address. */
  function publicHost(name: string): void {
    net.publicStandIn = '127.0.0.1';
    net.answers.set(name, [['127.0.0.1']]);
  }

  it.each([['file:///etc/passwd'], ['data:text/plain;base64,c2VjcmV0'], ['ftp://example.com/x']])(
    'rejects the non-http scheme %s without issuing a request',
    async (uri) => {
      const assetId = await saveRef(uri);

      await expect(store.getContent(assetId)).rejects.toThrow(/scheme is not allowed/);
      expect(net.lookups).toEqual([]);
    },
  );

  it.each([
    ['http://127.0.0.1:8080/admin'],
    ['http://127.1.2.3/admin'],
    ['http://localhost:8080/admin'],
    ['http://metadata.google.internal/computeMetadata/v1/'],
    ['http://169.254.169.254/latest/meta-data/iam/security-credentials/'],
    ['http://10.0.0.1/internal'],
    ['http://192.168.0.5/internal'],
    ['http://172.16.3.4/internal'],
    ['http://0.0.0.0:9000/internal'],
    ['http://[::1]:8080/admin'],
    ['http://[fd00::1]/internal'],
    ['http://[fe80::1]/internal'],
    ['http://[::ffff:127.0.0.1]/admin'],
    // Obfuscated IPv4 forms — the WHATWG URL parser normalizes these to dotted-quad before the check.
    ['http://2130706433/admin'],
    ['http://0177.0.0.1/admin'],
    ['http://127.1/admin'],
  ])('rejects the private/loopback host %s without issuing a request', async (uri) => {
    const assetId = await saveRef(uri);

    await expect(store.getContent(assetId)).rejects.toThrow(/host is not allowed/);
    expect(net.lookups).toEqual([]);
  });

  it('refuses a DNS name that resolves to a private address, without connecting', async () => {
    net.answers.set('internal.example', [['127.0.0.1']]);
    const assetId = await saveRef(`http://internal.example:${port}/admin`);

    await expect(store.getContent(assetId)).rejects.toThrow(/host is not allowed.*127\.0\.0\.1/);
    expect(hits).toEqual([]);
  });

  it('refuses a DNS name when any of its addresses is private', async () => {
    net.publicStandIn = '127.0.0.1';
    net.answers.set('mixed.example', [['127.0.0.1', '10.0.0.7']]);
    const assetId = await saveRef(`http://mixed.example:${port}/`);

    await expect(store.getContent(assetId)).rejects.toThrow(/host is not allowed.*10\.0\.0\.7/);
    expect(hits).toEqual([]);
  });

  it('connects to the address it judged: a later private answer is never consulted', async () => {
    publicHost('rebind.example');
    net.answers.set('rebind.example', [['127.0.0.1'], ['169.254.169.254']]);
    const assetId = await saveRef(`http://rebind.example:${port}/image.jpg`);

    const result = await store.getContent(assetId);
    expect((await drain(result!.stream)).toString('utf-8')).toBe('remote payload');
    expect(net.lookups).toEqual(['rebind.example']);
    expect(hits).toEqual(['/image.jpg']);
  });

  it('allows a public http URI and streams the response body', async () => {
    publicHost('cdn.example');
    const assetId = await saveRef(`http://cdn.example:${port}/image.jpg`);

    const result = await store.getContent(assetId);
    expect(result).not.toBeUndefined();
    expect((await drain(result!.stream)).toString('utf-8')).toBe('remote payload');
    expect(hits).toEqual(['/image.jpg']);
  });

  it('returns undefined for a non-2xx response', async () => {
    publicHost('cdn.example');
    respond = () => ({ status: 404, body: 'missing' });
    const assetId = await saveRef(`http://cdn.example:${port}/absent.jpg`);

    await expect(store.getContent(assetId)).resolves.toBeUndefined();
  });

  it('bounds the body with the deadline: a stall mid-body errors instead of truncating', async () => {
    publicHost('cdn.example');
    server.removeAllListeners('request');
    server.on('request', (_req, res) => {
      res.writeHead(200);
      res.write('partial');
    });
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const assetId = await saveRef(`http://cdn.example:${port}/image.jpg`);

    const result = await store.getContent(assetId);
    deadline.abort(new Error('deadline reached'));
    await expect(drain(result!.stream)).rejects.toThrow();
  });

  it('judges every request on its own connection: an earlier approved socket is not reused', async () => {
    publicHost('cdn.example');
    const first = await store.getContent(await saveRef(`http://cdn.example:${port}/first.jpg`));
    await drain(first!.stream);

    // The same host and port are now private: a pooled keep-alive socket would skip the lookup.
    net.publicStandIn = undefined;
    const assetId = await saveRef(`http://cdn.example:${port}/second.jpg`);
    await expect(store.getContent(assetId)).rejects.toThrow(/host is not allowed/);
    expect(hits).toEqual(['/first.jpg']);
  });

  it('does not follow a redirect that lands on a private address', async () => {
    publicHost('cdn.example');
    respond = () => ({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    });
    const assetId = await saveRef(`http://cdn.example:${port}/image.jpg`);

    await expect(store.getContent(assetId)).rejects.toThrow(/host is not allowed/);
    expect(hits).toEqual(['/image.jpg']);
  });

  it('follows a redirect that stays on a public host', async () => {
    publicHost('cdn.example');
    respond = (url) =>
      url === '/image.jpg'
        ? { status: 302, headers: { location: `http://cdn.example:${port}/i.jpg` } }
        : { status: 200, body: 'redirected payload' };
    const assetId = await saveRef(`http://cdn.example:${port}/image.jpg`);

    const result = await store.getContent(assetId);
    expect((await drain(result!.stream)).toString('utf-8')).toBe('redirected payload');
    expect(hits).toEqual(['/image.jpg', '/i.jpg']);
  });
});
