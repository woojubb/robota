import { type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
const lossyFixture = fileURLToPath(new URL('./fixtures/supervised-lossy-grants.mjs', import.meta.url));
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

describe('external event grants on a supervised session', () => {
  it('opens exactly the grants it was handed, lists them without principals, and revokes one', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rs-grants-'));
    const root = join(scratch, 'supervised');
    let id: string | undefined;
    try {
      id = await launchSupervisedSession(process.cwd(), {
        entrypoint: fixture,
        execArgs: ['--import', 'tsx', '--conditions=source'],
        env: { ROBOTA_TEST_SUPERVISED_ROOT: root },
        root,
        grants: [grant('ci'), grant('chat')],
      });
      // The handoff is read and deleted before readiness; only the registration remains.
      expect(readdirSync(root).filter((name) => name.includes('grants'))).toEqual([]);
      expect(await listSupervisedExternalEvents(id, root)).toEqual([
        { grantId: 'ci', principal: 'client', state: 'open', counters: EMPTY },
        { grantId: 'chat', principal: 'client', state: 'open', counters: EMPTY },
      ]);
      await revokeSupervisedExternalEventGrant(id, 'ci', root);
      await expect(revokeSupervisedExternalEventGrant(id, 'nope', root)).rejects.toThrow(
        /holds no external event grant nope/,
      );
      await vi.waitFor(async () => {
        expect(await listSupervisedSessions(root, undefined, { includeExternalEvents: true })).toEqual([
          expect.objectContaining({
            id,
            externalEvents: [
              { grantId: 'ci', state: 'revoked', counters: EMPTY },
              { grantId: 'chat', state: 'open', counters: EMPTY },
            ],
          }),
        ]);
      }, { timeout: 15_000, interval: 100 });
      const listed = JSON.stringify(await listSupervisedSessions(root, undefined, { includeExternalEvents: true }));
      expect(listed).not.toContain(PRINCIPAL);
      expect(listed).not.toContain('issuer.example');
      expect(JSON.stringify(await listSupervisedSessions(root))).not.toContain('externalEvents');
      expect(readFileSync(join(root, id, 'state.json'), 'utf8')).not.toContain(PRINCIPAL);
      await stopSupervisedSession(id, root);
    } finally {
      if (id) {
        try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
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
          env: { ROBOTA_TEST_SUPERVISED_ROOT: root, ROBOTA_TEST_PERMISSION_MODE: 'bypassPermissions' },
          root,
          grants: [grant('ci')],
          onSpawn: (spawned) => { child = spawned; },
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
      await expect(launchSupervisedSession(process.cwd(), {
        entrypoint: lossyFixture,
        execArgs: [],
        env: {},
        root,
        grants: [grant('ci')],
        onSpawn: (spawned) => { child = spawned; },
      })).rejects.toThrow(/did not open exactly the external event grants/);
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
      expect(readdirSync(root).filter((name) => name.includes('grants'))).toEqual([]);
    } finally {
      if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 30_000);
});
