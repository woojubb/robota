import { type ChildProcess } from 'node:child_process';
import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  listSupervisedExternalEvents,
  listSupervisedSessions,
  revokeSupervisedExternalEventGrant,
  stopSupervisedSession,
} from '../supervised-session-control.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';

const fixture = fileURLToPath(new URL('./fixtures/supervised-serve-fixture.ts', import.meta.url));
const lossyFixture = fileURLToPath(
  new URL('./fixtures/supervised-lossy-grants.mjs', import.meta.url),
);
const PRINCIPAL = 'PRINCIPAL-VALUE-MUST-NOT-APPEAR';

function grant(grantId: string): IExternalEventGrant {
  return {
    grantId,
    verifier: {
      issuer: 'https://issuer.example',
      resource: `https://robota.example/events/${grantId}`,
      algorithms: ['ES256'],
      requiredScopes: ['robota.events.submit'],
      allowedClients: [PRINCIPAL],
    },
    kinds: ['message'],
  };
}

const EMPTY = { accepted: 0, refused: {}, settled: {} };

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (typeof address !== 'object' || address === null) throw new Error('no port');
  return address.port;
}

function post(
  port: number,
  grantId: string,
  token?: string,
): Promise<{ status: number; body: string; challenge?: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ kind: 'message', conversationId: 'c', content: 'hello' });
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/events/${grantId}`,
        headers: {
          host: 'robota.example',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => {
          const challenge = res.headers['www-authenticate'];
          resolve({
            status: res.statusCode ?? 0,
            body: text,
            ...(typeof challenge === 'string' ? { challenge } : {}),
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('external event grants on a supervised session', () => {
  it('opens exactly the grants it was handed, lists them without principals, and revokes one', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-grants-'));
    const root = join(scratch, 'supervised');
    let id: string | undefined;
    const port = await freePort();
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
        root,
        grants: [grant('ci'), grant('chat')],
        eventEndpoint: { port },
      });
      // The handoff is read and deleted before readiness; only the registration remains.
      expect(readdirSync(root).filter((name) => name.includes('grants'))).toEqual([]);
      expect(await listSupervisedExternalEvents(id, root)).toEqual([
        { grantId: 'ci', principal: 'client', state: 'open', counters: EMPTY },
        { grantId: 'chat', principal: 'client', state: 'open', counters: EMPTY },
      ]);
      // The endpoint listens on loopback at the given port and speaks for each grant.
      const missing = await post(port, 'ci');
      expect(missing).toMatchObject({ status: 401, body: '' });
      expect(missing.challenge).toBe(
        'Bearer resource_metadata="https://robota.example/.well-known/oauth-protected-resource/events/ci"',
      );
      expect(await post(port, 'nope', 'x')).toMatchObject({ status: 404, body: '' });
      expect(await post(port, 'ci', 'not-a-token')).toMatchObject({ status: 401, body: '' });
      await revokeSupervisedExternalEventGrant(id, 'ci', root);
      // Revoked, yet a caller without a valid token sees exactly what a live grant answers.
      expect(await post(port, 'ci', 'not-a-token')).toMatchObject({ status: 401, body: '' });
      // Refusals outlive the process in an owner-only trail that holds no token or content.
      // One open, so the mode checked and the text read belong to the same file.
      // 0o600 is a no-op without O_CREAT; it states an owner-only mode for static analysis.
      const trailFd = openSync(join(root, 'audit', `${id}.jsonl`), 'r', 0o600);
      let trail: string;
      try {
        expect(fstatSync(trailFd).mode & 0o777).toBe(0o600);
        trail = readFileSync(trailFd, 'utf8');
      } finally {
        closeSync(trailFd);
      }
      const records = trail
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(records.map((record) => record['refusal'])).toEqual([
        'missing-token',
        'unknown-grant',
        'malformed',
        'malformed',
      ]);
      expect(trail).not.toMatch(/not-a-token|hello|PRINCIPAL/);
      await expect(revokeSupervisedExternalEventGrant(id, 'nope', root)).rejects.toThrow(
        /holds no external event grant nope/,
      );
      await vi.waitFor(
        async () => {
          expect(
            await listSupervisedSessions(root, undefined, { includeExternalEvents: true }),
          ).toEqual([
            expect.objectContaining({
              id,
              externalEvents: [
                {
                  grantId: 'ci',
                  state: 'revoked',
                  counters: {
                    accepted: 0,
                    refused: { 'missing-token': 1, malformed: 2 },
                    settled: {},
                  },
                },
                { grantId: 'chat', state: 'open', counters: EMPTY },
              ],
            }),
          ]);
        },
        { timeout: 15_000, interval: 100 },
      );
      const listed = JSON.stringify(
        await listSupervisedSessions(root, undefined, { includeExternalEvents: true }),
      );
      expect(listed).not.toContain(PRINCIPAL);
      expect(listed).not.toContain('issuer.example');
      expect(JSON.stringify(await listSupervisedSessions(root))).not.toContain('externalEvents');
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain(PRINCIPAL);
      await stopSupervisedSession(id, root);
    } finally {
      if (id) {
        try {
          await stopSupervisedSession(id, root);
        } catch {
          /* already stopped */
        }
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails the start with a content-free reason when the session refuses a grant, leaving no child', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-grants-refused-'));
    const root = join(scratch, 'supervised');
    let child: ChildProcess | undefined;
    try {
      let message = '';
      try {
        await launchSupervisedSession(process.cwd(), {
          entrypoint: fixture,
          execArgs: ['--import', 'tsx', '--conditions=source'],
          env: {
            ROBOTA_TEST_SUPERVISED_ROOT: root,
            ROBOTA_TEST_PERMISSION_MODE: 'bypassPermissions',
          },
          root,
          grants: [grant('ci')],
          eventEndpoint: { port: await freePort() },
          onSpawn: (spawned) => {
            child = spawned;
          },
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe('grant ci: refused by the session.');
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
      expect(await listSupervisedSessions(root)).toEqual([]);
      expect(readdirSync(root).filter((name) => name.includes('grants'))).toEqual([]);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses a start whose child reports other grants than it was handed', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-grants-lost-'));
    const root = join(scratch, 'supervised');
    let child: ChildProcess | undefined;
    try {
      await expect(
        launchSupervisedSession(process.cwd(), {
          entrypoint: lossyFixture,
          execArgs: [],
          env: {},
          root,
          grants: [grant('ci')],
          eventEndpoint: { port: 1 },
          onSpawn: (spawned) => {
            child = spawned;
          },
        }),
      ).rejects.toThrow(/did not open exactly the external event grants/);
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
      expect(readdirSync(root).filter((name) => name.includes('grants'))).toEqual([]);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});
