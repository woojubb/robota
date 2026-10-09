import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer as httpsServer, request as httpsRequest } from 'node:https';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { OrganizationAudit, OrganizationFileLedgerAnchor } from '@robota-sdk/agent-organization-host';
import { hostedWorkerCliFixture } from '../../__tests__/helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from '../../__tests__/helpers/hosted-scripted-broker.js';
import {
  organizationOwnerFixture,
  organizationOwnerAuditFixture,
} from './organization-owner-fixture.js';
import { HostedOrganizationControl } from '../hosted-organization-control.js';
import { HostedDesktopAuthorization } from '../desktop/authorization.js';
import { HostedDesktopAuthorityStore } from '../desktop/authority-store.js';
import { desktopPromptDigest, HostedDesktopWorkerPort } from '../desktop/worker-port.js';
import { HostedDesktopGateway } from '../desktop/gateway.js';

async function port(): Promise<number> {
  const server = netServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
async function listen(server: ReturnType<typeof httpsServer>): Promise<number> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as { port: number }).port;
}
const pause = () => new Promise((done) => setTimeout(done, 100));

it.each(['/desktop/', '/'])(
  'connects the stock CLI worker through real TLS, pins its session, rejects hostile ingress, rotates reconnect credentials and withdraws active access',
  async (route) => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-tls-'));
    const custody = mkdtempSync(join(tmpdir(), 'desktop-company-anchor-'));
    const storeDirectory = mkdtempSync(join(tmpdir(), 'desktop-store-'));
    const storeCustody = mkdtempSync(join(tmpdir(), 'desktop-store-anchor-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      { stdio: 'ignore' },
    );
    execFileSync('chmod', ['644', join(directory, 'cert.pem')]);
    const ca = readFileSync(join(directory, 'cert.pem'));
    const key = readFileSync(join(directory, 'key.pem'));
    const f = await hostedWorkerCliFixture({}, { runTimeoutMs: 90_000 });
    const owner = organizationOwnerFixture(
      new OrganizationFileLedgerAnchor({ directory: custody, ledger: 'company' }),
      {
        tenant: f.f.config.identity.tenant,
        task: f.f.config.identity.task,
        actor: f.f.config.identity.actor,
        epoch: f.f.config.epoch,
      },
    );
    const a = organizationOwnerAuditFixture();
    const worker = {
      resource: f.f.config.worker.resource,
      identity: f.f.config.identity,
      grantId: owner.grant.id,
      epoch: owner.grant.epoch,
    };
    const control = new HostedOrganizationControl({
      ledger: owner.ledger,
      audit: new OrganizationAudit({
        stream: a.stream,
        publicKey: a.signer.publicKey,
        sink: a.sink,
        anchor: a.anchor,
      }),
      inventory: { list: async () => [worker], terminate: async () => undefined },
      actions: [],
      policyIntervalMs: 100,
      incidentOwners: {
        detection: 'security',
        containment: 'runtime',
        assessment: 'asset',
        recovery: 'owner',
        report: async () => undefined,
      },
    });
    const abort = new AbortController();
    let running: ReturnType<typeof f.run> | undefined;
    let workerPort: HostedDesktopWorkerPort | undefined;
    let gateway: HostedDesktopGateway | undefined;
    const clients = new Set<WebSocket>();
    const rawClients: ReturnType<typeof tlsConnect>[] = [];
    const signer = await generateKeyPair('EdDSA', { extractable: true });
    const jwk = {
      ...(await exportJWK(signer.publicKey)),
      kid: 'fixture',
      alg: 'EdDSA',
      use: 'sig',
    };
    let outage = false;
    let issuerUrl = '';
    const issuer = httpsServer({ ca, cert: ca, key }, (req, res) => {
      if (outage) {
        res.writeHead(503).end();
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(
          req.url === '/jwks'
            ? { keys: [jwk] }
            : { issuer: issuerUrl, jwks_uri: `${issuerUrl}/jwks` },
        ),
      );
    });
    const server = httpsServer({ cert: ca, key });
    const proxy = httpServer();
    let proxyGateway: HostedDesktopGateway | undefined;
    const exchange = (
      url: string,
      options: {
        headers?: Record<string, string>;
        body?: string;
        signal?: AbortSignal;
        method?: string;
      } = {},
    ) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpsRequest(
          url,
          {
            ca,
            servername: 'localhost',
            method: options.method ?? 'POST',
            headers: options.headers,
            signal: options.signal,
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode!, body }));
          },
        );
        req.once('error', reject);
        req.end(options.body);
      });
    const networkFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = Object.fromEntries(new Headers(init?.headers));
      const result = await exchange(String(input), {
        method: init?.method ?? 'GET',
        headers,
        signal: init?.signal ?? undefined,
      });
      return new Response(result.body, {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const runtimePort = await port();
      const taskPort = await port();
      const token = 'synthetic-private-runtime-token-123456789';
      const config = JSON.parse(readFileSync(f.execution, 'utf8'));
      writeFileSync(
        f.execution,
        JSON.stringify({ ...config, serve: { port: runtimePort, workerPort: taskPort, token } }),
      );
      const effect = join(f.worker, 'approved.txt');
      let requestTool = false;
      let toolEffect = effect;
      const calls = scriptedHostedBroker(f.f, () => {
        if (requestTool) {
          requestTool = false;
          return {
            tool: {
              name: 'Write',
              arguments: JSON.stringify({ filePath: toolEffect, content: 'APPROVED_ONCE' }),
            },
          };
        }
        return { content: 'REMOTE_DESKTOP_RESPONSE' };
      });
      running = f.run(['--serve', '--no-session-persistence'], abort.signal);
      for (let attempt = 0; attempt < 300 && workerPort === undefined; attempt++) {
        try {
          workerPort = await HostedDesktopWorkerPort.connect({
            endpoint: `ws://127.0.0.1:${runtimePort}/`,
            token,
            worker,
            control,
          });
        } catch {
          await pause();
        }
      }
      expect(workerPort).toBeDefined();
      issuerUrl = `https://127.0.0.1:${await listen(issuer)}`;
      const publicUrl = `https://127.0.0.1:${await listen(server)}${route}`;
      const baseUrl = publicUrl.replace(/\/$/u, '');
      const binding = {
        id: 'desktop-owner',
        user: 'alice',
        client: 'desktop',
        session: workerPort!.session,
        worker,
      };
      const authorization = new HostedDesktopAuthorization({
        publicUrl,
        issuer: issuerUrl,
        control,
        bindings: [binding],
        verifierDeps: { fetch: networkFetch, lookup: async () => ['127.0.0.1'] },
      });
      const store = new HostedDesktopAuthorityStore({
        directory: storeDirectory,
        anchor: new OrganizationFileLedgerAnchor({ directory: storeCustody, ledger: 'desktop' }),
        create: true,
      });
      gateway = new HostedDesktopGateway({
        server,
        authorization,
        store,
        ports: new Map([[binding.id, workerPort!]]),
        policyIntervalMs: 100,
      });
      const mint = (operator = false) =>
        new SignJWT({
          tenant: worker.identity.tenant,
          task: worker.identity.task,
          session: binding.session,
          workload: worker.identity.runtime,
          epoch: worker.epoch,
          client_id: binding.client,
          scope: operator ? 'desktop:approve' : 'desktop:pair desktop:drive',
        })
          .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: 'fixture' })
          .setIssuer(issuerUrl)
          .setAudience(operator ? `${baseUrl}/approval` : publicUrl)
          .setSubject(binding.user)
          .setJti(randomUUID())
          .setIssuedAt()
          .setExpirationTime('60s')
          .sign(signer.privateKey);
      const pair = async (jwt: string, headers: Record<string, string> = {}) =>
        exchange(`${baseUrl}/pair`, {
          headers: {
            authorization: `Bearer ${jwt}`,
            'content-type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({ binding: binding.id }),
        });
      await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
      proxyGateway = new HostedDesktopGateway({
        server: proxy,
        authorization,
        store,
        ports: new Map([[binding.id, workerPort!]]),
        trustedProxies: ['127.0.0.1'],
      });
      const proxyStatus = await new Promise<number>((done, fail) => {
        void mint().then((credential) => {
          const req = httpRequest(
            `http://127.0.0.1:${(proxy.address() as { port: number }).port}${route.replace(/\/$/u, '')}/pair`,
            {
              method: 'POST',
              headers: {
                host: new URL(publicUrl).host,
                'x-forwarded-host': new URL(publicUrl).host,
                'x-forwarded-proto': 'https',
                'x-forwarded-for': '192.0.2.1',
                authorization: `Bearer ${credential}`,
                origin: new URL(publicUrl).origin,
              },
            },
            (res) => {
              res.resume();
              res.once('end', () => done(res.statusCode!));
            },
          );
          req.once('error', fail);
          req.end(JSON.stringify({ binding: binding.id }));
        }, fail);
      });
      expect(proxyStatus).toBe(200);
      const upgradeOptions = {
        host: '127.0.0.1',
        port: Number(new URL(publicUrl).port),
        ca,
        allowHalfOpen: true,
      };
      const halfOpen = tlsConnect(upgradeOptions);
      rawClients.push(halfOpen);
      let rejection = '';
      halfOpen.on('data', (bytes) => {
        rejection += String(bytes);
      });
      await new Promise<void>((done, fail) => {
        halfOpen.once('secureConnect', done);
        halfOpen.once('error', fail);
      });
      halfOpen.write(
        `GET ${new URL(`${baseUrl}/connect`).pathname}?binding=${binding.id}&generation=0 HTTP/1.1\r\nHost: ${new URL(publicUrl).host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\n\r\n`,
      );
      await expect.poll(() => rejection).toContain('403');
      const jwt = await mint();
      for (const headers of [
        { host: 'wrong.example' },
        { origin: 'https://hostile.example' },
        { 'x-forwarded-for': '127.0.0.1' },
        { 'x-forwarded-proto': 'http' },
      ] as Record<string, string>[]) {
        expect((await pair(jwt, headers)).status).toBe(403);
      }
      expect((await pair(await mint(true))).status).toBe(403);
      for (const operator of ['invalid-signature', await mint()]) {
        expect(
          (
            await pair(await mint(), {
              'x-desktop-operator-authorization': `Bearer ${operator}`,
            })
          ).status,
        ).toBe(403);
      }
      const paired = await pair(jwt);
      expect(paired.status, paired.body).toBe(200);
      const access = JSON.parse(paired.body) as {
        generation: number;
        token: string;
        approvalToken: string | null;
      };
      expect(access.approvalToken).toBeNull();
      expect(
        (
          await exchange(`${baseUrl}/approval`, {
            headers: { authorization: `Bearer ${access.token}` },
            body: JSON.stringify({
              binding: binding.id,
              generation: access.generation,
              id: 'forged',
              digest: '0'.repeat(64),
              allow: true,
            }),
          })
        ).status,
      ).toBe(403);
      expect((await pair(jwt)).status).toBe(403);
      const open = async (credentials: typeof access) => {
        const ws = new WebSocket(
          `${baseUrl.replace('https:', 'wss:')}/connect?binding=${binding.id}&generation=${credentials.generation}`,
          { ca, headers: { authorization: `Bearer ${credentials.token}` } },
        );
        clients.add(ws);
        const messages: Record<string, unknown>[] = [];
        ws.on('message', (data) => messages.push(JSON.parse(String(data))));
        ws.on('error', () => undefined);
        await new Promise<void>((resolve, reject) => {
          ws.once('open', resolve);
          ws.once('error', reject);
        });
        return { ws, messages };
      };
      const first = await open(access);
      await expect
        .poll(() =>
          first.messages.some(
            (frame) =>
              frame.type === 'session_status' &&
              (frame.status as { sessionId: string }).sessionId === binding.session,
          ),
        )
        .toBe(true);
      first.ws.send(JSON.stringify({ type: 'submit', prompt: 'Hello remote worker' }));
      await expect
        .poll(() => JSON.stringify(first.messages), { timeout: 15_000 })
        .toContain('REMOTE_DESKTOP_RESPONSE');
      expect(calls.length).toBeGreaterThan(0);
      const activeClosed = new Promise<void>((resolve) => first.ws.once('close', () => resolve()));
      const updated = await pair(await mint());
      expect(updated.status).toBe(200);
      await activeClosed;
      await expect(open(access)).rejects.toThrow();
      const second = await open(JSON.parse(updated.body));
      await expect
        .poll(() =>
          second.messages.some(
            (frame) =>
              frame.type === 'session_status' &&
              (frame.status as { sessionId: string }).sessionId === binding.session,
          ),
        )
        .toBe(true);
      const removed = new Promise<void>((resolve) => second.ws.once('close', () => resolve()));
      second.ws.send(JSON.stringify({ type: 'permission-response', id: 'forged', result: true }));
      await removed;
      const racing = await Promise.all([pair(await mint()), pair(await mint())]);
      expect(racing.map((response) => response.status)).toEqual([200, 200]);
      const candidates = racing.map((response) => JSON.parse(response.body));
      candidates.sort((left, right) => left.generation - right.generation);
      await expect(open(candidates[0])).rejects.toThrow();
      const raceWinner = await open(candidates[1]);
      expect(raceWinner.ws.readyState).toBe(WebSocket.OPEN);
      const operatorPair = await pair(await mint(), {
        'x-desktop-operator-authorization': `Bearer ${await mint(true)}`,
      });
      expect(operatorPair.status, operatorPair.body).toBe(200);
      const operatorAccess = JSON.parse(operatorPair.body);
      const operatorClient = await open(operatorAccess);
      requestTool = true;
      operatorClient.ws.send(
        JSON.stringify({ type: 'submit', prompt: 'Write the requested file' }),
      );
      await expect
        .poll(() => operatorClient.messages.find((frame) => frame.type === 'permission_request'), {
          timeout: 15_000,
        })
        .toBeDefined();
      const prompt = operatorClient.messages.find((frame) => frame.type === 'permission_request')!
        .event as Record<string, unknown>;
      const approval = {
        binding: binding.id,
        generation: operatorAccess.generation,
        id: prompt.id,
        digest: desktopPromptDigest(prompt),
        allow: true,
      };
      const approve = (token: string, body = approval) =>
        exchange(`${baseUrl}/approval`, {
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      expect(existsSync(effect)).toBe(false);
      expect((await approve(operatorAccess.token)).status).toBe(403);
      expect(
        (await approve(operatorAccess.approvalToken, { ...approval, digest: '0'.repeat(64) }))
          .status,
      ).toBe(403);
      expect((await approve(operatorAccess.approvalToken)).status).toBe(204);
      expect((await approve(operatorAccess.approvalToken)).status).toBe(403);
      await expect.poll(() => existsSync(effect)).toBe(true);
      expect(readFileSync(effect, 'utf8')).toBe('APPROVED_ONCE');
      if (process.env.PRODUCT_DESKTOP_NATIVE_E2E_EXECUTABLE) {
        const nativeModule = fileURLToPath(
          new URL('../../../../../apps/agent-app/e2e/remote-runtime-e2e.mjs', import.meta.url),
        );
        const { exerciseDesktopRemote } = await import(nativeModule);
        const nativeEffect = join(f.worker, 'native-approved.txt');
        await exerciseDesktopRemote({
          directory,
          publicUrl,
          binding: binding.id,
          jwt: await mint(),
          operatorJwt: await mint(true),
          session: binding.session,
          requestTool: () => {
            toolEffect = nativeEffect;
            requestTool = true;
          },
        });
        await expect.poll(() => existsSync(nativeEffect)).toBe(true);
        expect(readFileSync(nativeEffect, 'utf8')).toBe('APPROVED_ONCE');
      }
      const current = await pair(await mint());
      const third = await open(JSON.parse(current.body));
      const stopped = new Promise<void>((resolve) => third.ws.once('close', () => resolve()));
      outage = true;
      await stopped;
      expect((await pair(await mint())).status).toBe(403);
      outage = false;
      const afterOutage = await pair(await mint());
      expect(afterOutage.status).toBe(200);
      const fourth = await open(JSON.parse(afterOutage.body));
      const revoked = new Promise<void>((resolve) => fourth.ws.once('close', () => resolve()));
      owner.ledger.revokeGrant(owner.grant.id);
      await revoked;
      expect((await pair(await mint())).status).toBe(403);
      expect(JSON.stringify(first.messages)).not.toContain(token);
      expect(JSON.stringify(first.messages)).not.toContain(access.token);
      outage = true;
      expect((await pair(await mint())).status).toBe(403);
      await gateway.close();
      await Promise.race([
        new Promise<void>((done) => server.close(() => done())),
        new Promise<never>((_done, fail) => {
          const timer = setTimeout(
            () => fail(new Error('Raw upgrade prevented gateway teardown')),
            1000,
          );
          timer.unref();
        }),
      ]);
    } finally {
      for (const raw of rawClients) raw.destroy();
      for (const ws of clients) ws.terminate();
      await proxyGateway?.close();
      await new Promise<void>((done) => proxy.close(() => done()));
      await gateway?.close();
      workerPort?.close();
      abort.abort();
      await running?.catch(() => undefined);
      await control.close();
      await f.close();
      owner.cleanup();
      await Promise.all(
        [server, issuer].map(
          (listener) => new Promise<void>((resolve) => listener.close(() => resolve())),
        ),
      );
      for (const path of [directory, custody, storeDirectory, storeCustody])
        rmSync(path, { recursive: true, force: true });
    }
  },
  120_000,
);
