import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { createProcessOperationLock, NodeSessionStore } from '@robota-sdk/agent-session/node';
import { createProcessMarkers } from '@robota-sdk/agent-core/node';

import {
  assertWindowsPrivatePath,
  currentWindowsSid,
  isPrivateWindowsSddl,
  createWindowsPrivateDirectory,
  readWindowsProcessIdentity,
  readWindowsProcessStartTime,
} from '../windows-security.js';
import { readProcessStartTime } from '../../remote-control/local-peer-registry.js';

const SID = 'S-1-5-21-1-2-3-1001';

describe('Windows daemon security', () => {
  it('accepts a protected descriptor granting only this user access', () => {
    expect(isPrivateWindowsSddl(`O:${SID}D:P(A;OICI;FA;;;${SID})`, SID, true)).toBe(true);
    expect(isPrivateWindowsSddl(`O:BAD:PAI(A;;FA;;;${SID})(A;;FA;;;SY)`, SID, true)).toBe(true);
  });

  it('compares fixed service account aliases with the exact numeric account', () => {
    expect(isPrivateWindowsSddl('O:SYD:P(A;OICI;FA;;;SY)', 'S-1-5-18', true)).toBe(true);
    expect(isPrivateWindowsSddl('O:LSD:P(A;OICI;FA;;;LS)', 'S-1-5-19', true)).toBe(true);
    expect(isPrivateWindowsSddl('O:SYD:P(A;OICI;FA;;;SY)', SID, true)).toBe(false);
    expect(isPrivateWindowsSddl(`O:${SID}D:P(A;;FA;;;LS)(A;;FA;;;${SID})`, SID, true)).toBe(false);
  });

  it('refuses public, inherited, null, incomplete, and foreign-owner descriptors', () => {
    for (const descriptor of [
      `O:${SID}D:P(A;;FA;;;WD)(A;;FA;;;${SID})`,
      `O:${SID}D:AI(A;;FA;;;${SID})`,
      `O:${SID}D:NO_ACCESS_CONTROL`,
      `O:${SID}D:P(A;;FR;;;${SID})`,
      `O:S-1-5-21-9D:P(A;;FA;;;${SID})`,
      `O:${SID}D:P(A;IO;FA;;;${SID})`,
      `O:${SID}D:P(A;;FA;;;${SID})junk`,
    ])
      expect(isPrivateWindowsSddl(descriptor, SID, true)).toBe(false);
  });

  it('allows inherited files only when the ACL still grants no other unprivileged account access', () => {
    expect(isPrivateWindowsSddl(`O:${SID}D:AI(A;ID;FA;;;${SID})`, SID, false)).toBe(true);
    expect(isPrivateWindowsSddl(`O:${SID}D:AI(A;ID;FA;;;AU)`, SID, false)).toBe(false);
  });

  it('distinguishes local administrators by their complete account SID', () => {
    const local = 'S-1-5-21-1-2-3-500';
    const foreign = 'S-1-5-21-4-5-6-500';
    expect(isPrivateWindowsSddl(`O:${local}D:P(A;;FA;;;${local})`, local, true)).toBe(true);
    expect(isPrivateWindowsSddl(`O:${foreign}D:P(A;;FA;;;${local})`, local, true)).toBe(false);
    expect(isPrivateWindowsSddl(`O:${local}D:P(A;;FA;;;${foreign})`, local, true)).toBe(false);
    expect(isPrivateWindowsSddl('O:LAD:P(A;;FA;;;LA)', local, true)).toBe(false);
  });

  it('selects the Windows creation-time reader instead of /proc', () => {
    expect(
      readProcessStartTime(
        123,
        'win32',
        () => undefined,
        () => '133700000000000001',
      ),
    ).toBe('133700000000000001');
  });

  it.runIf(process.platform === 'win32')('reads this actual Windows process identity', () => {
    expect(readWindowsProcessStartTime(process.pid)).toMatch(/^[0-9]+$/);
    expect(readWindowsProcessIdentity(process.pid)).toEqual({
      sid: currentWindowsSid(),
      startedAt: readWindowsProcessStartTime(process.pid),
    });
    expect(readWindowsProcessStartTime(0)).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')(
    'protects storage before secrets and refuses exposed files and junctions',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'test-product-acl-test-'));
      try {
        const storage = join(root, 'storage');
        mkdirSync(storage);
        expect(() => assertWindowsPrivatePath(storage, true)).toThrow();
        expect(() => createWindowsPrivateDirectory(storage)).toThrow(/not private/);
        rmSync(storage, { recursive: true });
        execFileSync('icacls.exe', [root, '/grant', '*S-1-1-0:(OI)(CI)F']);
        createWindowsPrivateDirectory(storage);
        expect(() => createWindowsPrivateDirectory(storage, true)).toThrow(/already exists/);
        expect(() => assertWindowsPrivatePath(storage, true)).not.toThrow();
        const registration = join(storage, 'registration.json');
        writeFileSync(registration, '{}');
        expect(() => assertWindowsPrivatePath(registration, false)).not.toThrow();
        execFileSync('icacls.exe', [registration, '/grant', '*S-1-1-0:R']);
        expect(() => assertWindowsPrivatePath(registration, false)).toThrow(/not private/);
        const junction = join(root, 'junction');
        symlinkSync(storage, junction, 'junction');
        expect(() => assertWindowsPrivatePath(junction, true)).toThrow(/reparse/);
        expect(() => createWindowsPrivateDirectory(junction)).toThrow(/reparse/);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe('Windows session operation guard', () => {
  it.runIf(process.platform === 'win32')('compares hard links using descriptor identities', () => {
    const root = mkdtempSync(join(tmpdir(), 'test-session-link-'));
    try {
      const first = join(root, 'temporary');
      const second = join(root, 'marker');
      writeFileSync(first, 'owner');
      const firstDescriptor = openSync(first, 'r');
      try {
        const temporary = fstatSync(firstDescriptor, { bigint: true });
        linkSync(first, second);
        const secondDescriptor = openSync(second, 'r');
        try {
          const opened = fstatSync(secondDescriptor, { bigint: true });
          const pathStat = lstatSync(first, { bigint: true });
          const identity = (stat: typeof temporary): string => `${stat.dev}/${stat.ino}`;
          expect(identity(opened), `path observation ${identity(pathStat)}`).toBe(
            identity(temporary),
          );
        } finally {
          closeSync(secondDescriptor);
        }
      } finally {
        closeSync(firstDescriptor);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'win32')(
    'treats a marker junction as unknown without following it',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'test-session-junction-'));
      try {
        const claims = join(root, 'claims');
        const target = join(root, 'target');
        mkdirSync(claims);
        mkdirSync(target);
        writeFileSync(join(target, 'keep'), 'unchanged');
        symlinkSync(target, join(claims, 'session_a.owner'), 'junction');
        const markers = createProcessMarkers(claims, {
          operationLock: createProcessOperationLock(claims),
          lockWaitMs: 0,
        });
        expect(markers.inspect('session_a')).toMatchObject({
          status: 'held',
          holder: { liveness: 'unknown' },
        });
        expect(markers.acquire('session_a').status).toBe('held');
        expect(lstatSync(join(claims, 'session_a.owner')).isSymbolicLink()).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === 'win32')('saves and releases a claim made by this process', () => {
    const root = mkdtempSync(join(tmpdir(), 'test-session-claim-'));
    try {
      const store = new NodeSessionStore(root, { sealing: 'plain' });
      const claim = store.claim('session_a', { fresh: true });
      store.save(
        {
          id: 'session_a',
          cwd: root,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messages: [],
        },
        { claim },
      );
      claim.release();
      expect(store.hasWriter('session_a')).toBe(false);
      const next = store.claim('session_a');
      expect(next.outcome.status).toBe('valid');
      next.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'win32')(
    'does not mistake a replacement marker for its earlier claim',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'test-session-replaced-'));
      const id = 'session_a';
      const record = (name: string) => ({
        id,
        name,
        cwd: root,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [],
      });
      try {
        const first = new NodeSessionStore(root, { sealing: 'plain' });
        const old = first.claim(id, { fresh: true });
        first.save(record('old'), { claim: old });
        const claims = join(root, 'claims');
        const breaker = createProcessMarkers(claims, {
          operationLock: createProcessOperationLock(claims),
          lockWaitMs: 0,
        });
        expect(breaker.remove(id, { force: true }).status).toBe('removed');
        const second = new NodeSessionStore(root, { sealing: 'plain' });
        const current = second.claim(id);
        second.save(record('new'), { claim: current });
        expect(() => first.save(record('stale'), { claim: old })).toThrow();
        old.release();
        second.save(record('still-new'), { claim: current });
        const loaded = second.load(id);
        expect(loaded.status).toBe('valid');
        if (loaded.status === 'valid') expect(loaded.record.name).toBe('still-new');
        current.release();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === 'win32')(
    'excludes another process and recovers after the holder is killed',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'test-session-guard-'));
      const moduleUrl = pathToFileURL(
        createRequire(import.meta.url).resolve('@robota-sdk/agent-session/node'),
      ).href;
      const script = `import { createProcessOperationLock, NodeSessionStore } from ${JSON.stringify(moduleUrl)}; import { join } from 'node:path'; const root = process.argv[1]; const store = new NodeSessionStore(root, { sealing: 'plain' }); store.claim('session_a', { fresh: true }); const lock = createProcessOperationLock(join(root, 'claims')).tryAcquire('session_a'); if (!lock) process.exit(2); process.send('ready'); setInterval(() => {}, 1000);`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, root], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      try {
        expect((await once(child, 'message', { signal: AbortSignal.timeout(10_000) }))[0]).toBe(
          'ready',
        );
        const lock = createProcessOperationLock(join(root, 'claims'));
        expect(lock.tryAcquire('session_a')).toBeUndefined();
        const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) });
        child.kill('SIGKILL');
        await exited;
        const recovered = lock.tryAcquire('session_a');
        expect(recovered).toBeDefined();
        recovered?.release();
        const store = new NodeSessionStore(root, { sealing: 'plain' });
        const claim = store.claim('session_a', { fresh: true });
        claim.release();
        expect(store.hasWriter('session_a')).toBe(false);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
