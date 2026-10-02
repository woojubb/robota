import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'egress-tls-fixture-'));
  const certificate = join(directory, 'certificate.pem');
  const key = join(directory, 'fixture-key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=pinned-fixture.invalid',
      '-addext',
      'subjectAltName=DNS:pinned-fixture.invalid',
      '-keyout',
      key,
      '-out',
      certificate,
    ],
    { stdio: 'ignore' },
  );
  const requests: { host?: string; servername: string | false | null }[] = [];
  const server: Server = createServer(
    { key: readFileSync(key), cert: readFileSync(certificate) },
    (request, response) => {
      requests.push({
        host: request.headers.host,
        servername: (request.socket as TLSSocket).servername,
      });
      response.end('tls-fixture-canary');
    },
  );
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TLS fixture listener unavailable');
  return { port: address.port, certificate, requests };
}

function client(
  url: string,
  certificate?: string,
): Promise<{ ok: boolean; body?: string; code?: string }> {
  const entry = new URL('../../dist/node/node.js', import.meta.url).href;
  const script = `import { fetchWithEgressPolicy } from ${JSON.stringify(entry)};
  try {
    const url = process.argv[1];
    const result = await fetchWithEgressPolicy(url, { timeoutMs: 2000 },
      { allowedHosts: [new URL(url).hostname] }, { lookup: async () => ['127.0.0.1'] });
    process.stdout.write(JSON.stringify(result.ok ? { ok: true, body: Buffer.from(result.body).toString() } : { ok: false, code: result.rejection.reason }));
  } catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.cause?.code ?? error.code ?? error.name })); }`;
  return new Promise((resolve, reject) => {
    // The disposable certificate is trusted only in this fixture child. Parent/user trust settings stay untouched.
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, url], {
      env: certificate ? { NODE_EXTRA_CA_CERTS: certificate } : {},
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (data: Buffer) => chunks.push(data));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error('TLS fixture child failed'));
        return;
      }
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString()) as {
            ok: boolean;
            body?: string;
            code?: string;
          },
        );
      } catch {
        reject(new Error('TLS fixture response unavailable'));
      }
    });
  });
}

describe('actual pinned HTTPS identity and certificate validation', () => {
  it('keeps URL Host/SNI and validates the certificate against that hostname while connecting to the pinned IP', async () => {
    const f = await fixture();
    expect(await client(`https://pinned-fixture.invalid:${f.port}/`, f.certificate)).toEqual({
      ok: true,
      body: 'tls-fixture-canary',
    });
    expect(f.requests).toEqual([
      { host: `pinned-fixture.invalid:${f.port}`, servername: 'pinned-fixture.invalid' },
    ]);
  });

  it('refuses a trusted certificate for the wrong original hostname before an HTTP request is sent', async () => {
    const f = await fixture();
    expect(await client(`https://wrong-fixture.invalid:${f.port}/`, f.certificate)).toEqual({
      ok: false,
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    expect(f.requests).toHaveLength(0);
  });

  it('does not disable certificate verification to make a pinned connection work', async () => {
    const f = await fixture();
    expect(await client(`https://pinned-fixture.invalid:${f.port}/`)).toEqual({
      ok: false,
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    expect(f.requests).toHaveLength(0);
  });
});
