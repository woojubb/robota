import { execFile } from 'node:child_process';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { canonical } from '../../research/agent-organization-security/poc/canonical-json.mjs';

const execute = promisify(execFile);
const client = fileURLToPath(
  new URL(
    '../../research/agent-organization-security/poc/guest-broker-client.mjs',
    import.meta.url,
  ),
);
const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });

async function exercise(handler, requests, check) {
  const directory = await mkdtemp(join(tmpdir(), 'guest-broker-client-'));
  const keys = generateKeyPairSync('ed25519');
  const actorPrivate = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const credential = { synthetic: 'FIXTURE_JOB_CANARY' };
  const broker = createServer(handler);
  try {
    await listen(broker, 19090);
    const file = join(directory, 'job.json');
    await writeFile(file, JSON.stringify({ actorPrivate, credential, requests }), { mode: 0o600 });
    const result = await execute(process.execPath, [client, file], { timeout: 7000 });
    await check(JSON.parse(result.stdout), keys.publicKey, credential, actorPrivate);
  } finally {
    await close(broker);
    await rm(directory, { recursive: true, force: true });
  }
}

it('preserves signed synthetic requests and the management-route denial experiment', async () => {
  const captured = [];
  await exercise(
    async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      captured.push({ path: req.url, body, request: JSON.parse(body) });
      res.writeHead(req.url === '/apply' ? 200 : 404, { 'content-type': 'application/json' });
      res.end('{"synthetic":true}');
    },
    [
      { operation: { synthetic: 'charge' }, nonce: 'fixed-nonce' },
      {
        path: '/admin',
        operation: { synthetic: 'admin' },
        credentialOverride: { synthetic: 'other-actor' },
        corruptProof: true,
      },
    ],
    (records, publicKey, credential, actorPrivate) => {
      expect(records.map((record) => record.status)).toEqual([200, 404]);
      expect(captured.map((item) => item.path)).toEqual(['/apply', '/admin']);
      const { proof, ...signed } = captured[0].request;
      expect(signed.credential).toEqual(credential);
      expect(signed.nonce).toBe('fixed-nonce');
      expect(
        verify(null, Buffer.from(canonical(signed)), publicKey, Buffer.from(proof, 'base64url')),
      ).toBe(true);
      expect(captured[1].request.credential).toEqual({ synthetic: 'other-actor' });
      expect(captured[1].request.proof).toBe('invalid-signature');
      expect(captured.map((item) => item.body).join('')).not.toContain(actorPrivate);
    },
  );
});

it('rejects route manipulation before transmitting signed job data', async () => {
  const captured = [];
  await exercise(
    (req, res) => {
      captured.push(req.url);
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    },
    ['/apply#ignored', '/apply?extra=1', '//other.example/apply'].map((path) => ({
      path,
      operation: {},
    })),
    (records) => {
      expect(captured).toEqual([]);
      expect(records).toEqual(
        Array(3).fill({ status: 0, result: { reason: 'transport-disconnected' } }),
      );
    },
  );
});

it.each([307, 308])('does not forward signed job data through a %i redirect', async (status) => {
  const captured = [];
  const destination = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    captured.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"accepted":true}');
  });
  try {
    await listen(destination, 0);
    await exercise(
      (req, res) => {
        req.resume();
        res.writeHead(status, {
          location: `http://127.0.0.1:${destination.address().port}/capture`,
        });
        res.end();
      },
      [{ operation: { synthetic: 'charge' }, nonce: 'fixed-nonce' }],
      (records) => {
        expect(captured).toEqual([]);
        expect(records).toEqual([{ status: 0, result: { reason: 'transport-disconnected' } }]);
      },
    );
  } finally {
    await close(destination);
  }
});
