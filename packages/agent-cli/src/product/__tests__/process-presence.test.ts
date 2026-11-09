/**
 * Presence: a process that builds a conversation store marks itself under the state root's
 * `presence/` the first time it does, and a migration marks itself before it looks, so whichever comes
 * second sees the first. Real child processes stand in for the other side, so liveness is judged by
 * the same probes production uses.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectProcessScopedDirectories,
  readCurrentProcessIdentity,
  readProcessStartTime,
} from '@robota-sdk/agent-core/node';
import { goneProcessOwner, leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { runSecureCommand } from '../../secure/secure-command.js';
import { writeProductConversationMode } from '../../secure/conversation-mode-state.js';
import { sweepStaleEphemeralState } from '../../startup/ephemeral-state.js';
import { resolveCliRuntimeContext } from '../../startup/product-bootstrap.js';
import {
  MIGRATION_RUNNING_MESSAGE,
  ProductMigrationRunningError,
  declareProductProcessMode,
  listProductPresence,
  writeProductMigrationMarker,
} from '../process-presence.js';
import {
  createProductPromptHistoryFile,
  createProductToolResultSpillStore,
  createProductUserSessionStore,
} from '../session-stores.js';

import type { IProcessIdentity } from '@robota-sdk/agent-core/node';
import type { ICliRuntimeContext } from '../runtime-context.js';

const posixOnly = process.platform === 'win32';
const OWNER_RECORD = '.owner.json';

let home: string;
let runtime: ICliRuntimeContext;
const children: ChildProcess[] = [];

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'process-presence-')));
  runtime = createTestProductRuntime('test-product', { HOME: home });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.kill('SIGKILL');
  rmSync(home, { recursive: true, force: true });
});

const presenceDirectory = (): string => runtime.layout.userPaths.presence;
const entries = (prefix: string): string[] =>
  existsSync(presenceDirectory())
    ? readdirSync(presenceDirectory()).filter((name) => name.startsWith(prefix))
    : [];

/** A real process that stays alive until the test ends, with its identity as its own record would state it. */
async function liveProcess(): Promise<IProcessIdentity> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const pid = child.pid as number;
  const startTime = readProcessStartTime(pid);
  if (startTime === undefined) throw new Error('the start time of a live child could not be read');
  return { ...readCurrentProcessIdentity(), pid, startTime };
}

/** Another process's presence (or marker, with `migration-`), exactly as its run would leave it. */
function leavePresence(prefix: string, owner: IProcessIdentity, mode?: string): string {
  const directory = leaveProcessScopedDirectory(presenceDirectory(), prefix, owner);
  rmSync(join(directory, 'content.txt'));
  if (mode !== undefined) writeFileSync(join(directory, 'mode'), mode);
  return directory;
}

/** A presence (or marker) as a crash between creating it and writing its owner record left it, `ageMs` ago. */
function leaveOwnerless(prefix: string, suffix: string, ageMs: number): string {
  const directory = join(presenceDirectory(), `${prefix}4242-${suffix}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const at = new Date(Date.now() - ageMs);
  utimesSync(directory, at, at);
  return directory;
}

describe.skipIf(posixOnly)('presence at store construction', () => {
  it('keeps secure mode on when another process still owns a conversation store', async () => {
    writeProductConversationMode(runtime.layout.userRoot, 'plain', 'preparing');
    writeProductConversationMode(runtime.layout.userRoot, 'preparing', 'secure');
    leavePresence('process-', await liveProcess(), 'interactive');
    const selected = resolveCliRuntimeContext({
      productConfig: runtime.config,
      environment: runtime.environment,
    });
    const errors: string[] = [];

    const code = await runSecureCommand(['disable'], {
      productRuntime: selected,
      stdinIsTTY: true,
      confirm: async () => 'yes',
      stdout: () => {},
      stderr: (message) => errors.push(message),
    });

    expect(code).toBe(1);
    expect(errors.join('')).toContain('remain active or uncertain');
    expect(resolveCliRuntimeContext({
      productConfig: runtime.config,
      environment: runtime.environment,
    }).conversationMode).toBe('secure');
  });

  it('is created at the first store construction, once, naming this process', () => {
    createProductUserSessionStore(runtime);
    createProductPromptHistoryFile(runtime);
    createProductToolResultSpillStore(runtime);

    const [name, ...others] = entries('process-');
    expect(others).toEqual([]);
    expect(name).toMatch(new RegExp(`^process-${process.pid}-[A-Za-z0-9]{6}$`));
    const directory = join(presenceDirectory(), name as string);
    const owner = JSON.parse(
      readFileSync(join(directory, OWNER_RECORD), 'utf8'),
    ) as IProcessIdentity;
    expect(owner).toEqual(readCurrentProcessIdentity());
    expect(readFileSync(join(directory, 'mode'), 'utf8')).toBe('command');
    expect(readdirSync(directory).sort()).toEqual([OWNER_RECORD, 'mode']);
  });

  it('is not created by a command that builds no store', async () => {
    const code = await runSecureCommand(['status'], {
      productRuntime: runtime,
      stdout: () => {},
      stderr: () => {},
    });

    expect(code).toBe(0);
    expect(existsSync(presenceDirectory())).toBe(false);
  });

  it('names the mode the process declares, even when a store came first', () => {
    createProductUserSessionStore(runtime);
    declareProductProcessMode(runtime, 'print');

    const [name] = entries('process-');
    expect(readFileSync(join(presenceDirectory(), name as string, 'mode'), 'utf8')).toBe('print');
  });

  it('refuses a store when its process presence cannot be created', () => {
    mkdirSync(runtime.layout.userRoot, { recursive: true });
    writeFileSync(presenceDirectory(), 'not a directory');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => createProductUserSessionStore(runtime)).toThrow(/could not mark this process/i);
    expect(() => createProductPromptHistoryFile(runtime)).toThrow(/could not mark this process/i);

    const notices = stderr.mock.calls.flat().join('');
    expect(notices).toMatch(/^Could not mark this process in .*presence \(E[A-Z]+\): a migration/u);
    expect(notices.split('Could not mark').length - 1).toBe(1);
    expect(existsSync(runtime.layout.userPaths.sessions)).toBe(false);
  });

  it('refuses to open stores while a migration is running, and takes its presence back', async () => {
    const migration = leavePresence('migration-', await liveProcess());

    expect(() => createProductUserSessionStore(runtime)).toThrow(ProductMigrationRunningError);
    expect(() => createProductPromptHistoryFile(runtime)).toThrow(MIGRATION_RUNNING_MESSAGE);

    expect(entries('process-')).toEqual([]);
    expect(existsSync(migration)).toBe(true);
  });

  it('opens stores past the marker of a migration that is gone', () => {
    leavePresence('migration-', goneProcessOwner());

    expect(() => createProductUserSessionStore(runtime)).not.toThrow();
    expect(entries('process-')).toHaveLength(1);
  });

  it('refuses to open stores past a migration marker whose owner cannot be checked from here', () => {
    const marker = leavePresence('migration-', {
      ...readCurrentProcessIdentity(),
      pid: 4242,
      pidNamespace: 'pid:[4026531999]',
    });

    expect(() => createProductUserSessionStore(runtime)).toThrow(ProductMigrationRunningError);
    expect(() => createProductPromptHistoryFile(runtime)).toThrow(marker);
    expect(entries('process-')).toEqual([]);
  });

  it('opens stores while a compaction runs, since only a migration holds them', async () => {
    leavePresence('migration-', await liveProcess(), 'secure compact');

    expect(() => createProductUserSessionStore(runtime)).not.toThrow();
    expect(entries('process-')).toHaveLength(1);
  });

  it('passes, and the startup sweep removes, a marker its owner record never reached once its creation is long past', () => {
    const crashed = leaveOwnerless('migration-', 'CrAsh1', 10 * 60 * 1000);
    const creating = leaveOwnerless('migration-', 'N0wN0w', 0);

    expect(() => createProductUserSessionStore(runtime)).toThrow(creating);
    rmSync(creating, { recursive: true, force: true });
    expect(() => createProductUserSessionStore(runtime)).not.toThrow();

    sweepStaleEphemeralState(runtime);
    expect(existsSync(crashed)).toBe(false);
  });

  it('at startup removes only presences whose pid has ended, reading no start time; a migration looks fully', async () => {
    const recycled = leavePresence(
      'process-',
      { ...(await liveProcess()), startTime: 'not-when-that-pid-started' },
      'print',
    );

    sweepStaleEphemeralState(runtime);
    expect(existsSync(recycled)).toBe(true);

    const marker = writeProductMigrationMarker(runtime);
    expect(marker.others()).toEqual([]);
    expect(existsSync(recycled)).toBe(false);
    marker.release();
  });

  it('is swept at startup once its process is gone, with gone migration markers', () => {
    const goneProcess = leavePresence('process-', goneProcessOwner(), 'print');
    const goneMigration = leavePresence('migration-', goneProcessOwner());
    const otherContainer = leavePresence('process-', {
      ...readCurrentProcessIdentity(),
      pid: 4242,
      pidNamespace: 'pid:[4026531999]',
    });

    sweepStaleEphemeralState(runtime);

    expect(existsSync(goneProcess)).toBe(false);
    expect(existsSync(goneMigration)).toBe(false);
    expect(existsSync(otherContainer)).toBe(true);
  });
});

describe.skipIf(posixOnly)('a migration marker', () => {
  it('is written before anything is looked at, and lists every other process alive or unknown', async () => {
    const live = leavePresence('process-', await liveProcess(), 'interactive');
    const otherContainer = leavePresence('process-', {
      ...readCurrentProcessIdentity(),
      pid: 4242,
      pidNamespace: 'pid:[4026531999]',
    });
    const gone = leavePresence('process-', goneProcessOwner(), 'serve');

    const marker = writeProductMigrationMarker(runtime);
    const others = marker.others();

    expect(entries('migration-')).toEqual([marker.directory.split(/[\\/]/u).pop()]);
    expect(
      others.map(({ path, kind, liveness, mode }) => ({ path, kind, liveness, mode })),
    ).toEqual(
      expect.arrayContaining([
        { path: live, kind: 'process', liveness: 'alive', mode: 'interactive' },
        { path: otherContainer, kind: 'process', liveness: 'unknown', mode: 'mode not recorded' },
      ]),
    );
    expect(others).toHaveLength(2);
    expect(others.find((entry) => entry.path === live)?.startTime).toMatch(/\S/u);
    expect(others.find((entry) => entry.path === otherContainer)?.unknownBecause).toBe(
      'other-pid-namespace',
    );
    expect(existsSync(gone)).toBe(false);
    marker.release();
    expect(entries('migration-')).toEqual([]);
  });

  it('names a presence another machine left by its host, ahead of any pid namespace or boot', () => {
    // Same namespace and boot as this process, so only the host name says it is not ours: a pid and a
    // boot id of another machine mean nothing here.
    const elsewhere = leavePresence('process-', {
      ...readCurrentProcessIdentity(),
      pid: 4242,
      hostname: 'another-machine.example',
    });
    const unnamed = leavePresence('process-', {
      ...readCurrentProcessIdentity(),
      pid: 4343,
      hostname: undefined,
    });

    const marker = writeProductMigrationMarker(runtime);
    const others = marker.others();

    expect(others.find((entry) => entry.path === elsewhere)).toMatchObject({
      liveness: 'unknown',
      unknownBecause: 'other-machine',
      ownerHostname: 'another-machine.example',
    });
    // A record that names no host cannot be shown to be this machine's either.
    expect(others.find((entry) => entry.path === unnamed)).toMatchObject({
      liveness: 'unknown',
      unknownBecause: 'other-machine',
    });
    expect(others.find((entry) => entry.path === unnamed)?.ownerHostname).toBeUndefined();
    marker.release();
  });

  it('sees another migration, which in turn sees this one: both refuse', async () => {
    const other = leavePresence('migration-', await liveProcess());

    const marker = writeProductMigrationMarker(runtime);

    expect(marker.others()).toEqual([
      expect.objectContaining({
        path: other,
        kind: 'migration',
        liveness: 'alive',
        mode: 'secure migrate',
      }),
    ]);
    // What the other migration finds when it looks: this marker, alive.
    expect(
      inspectProcessScopedDirectories(presenceDirectory(), 'migration-').find(
        (entry) => entry.path === marker.directory,
      )?.liveness,
    ).toBe('alive');
    marker.release();
  });

  it('flushes its owner record and the directory holding it before it returns', () => {
    const flushed: string[] = [];

    const marker = writeProductMigrationMarker(runtime, {
      durability: {
        syncFile: () => flushed.push('owner record'),
        syncDirectory: (directory) => flushed.push(directory),
      },
    });

    expect(flushed).toEqual(['owner record', marker.directory]);
    marker.release();
  });

  it('passes over, and sweeps, a presence its owner record never reached once its creation is long past', () => {
    const crashed = leaveOwnerless('process-', 'CrAsh2', 10 * 60 * 1000);
    const creating = leaveOwnerless('process-', 'N0wN0w', 0);
    const marker = writeProductMigrationMarker(runtime);

    expect(marker.others()).toEqual([
      expect.objectContaining({
        path: creating,
        liveness: 'unknown',
        unknownBecause: 'no-owner-record',
      }),
    ]);
    expect(existsSync(crashed)).toBe(false);
    marker.release();
  });

  it('is never listed among the others by the process that wrote it, and a read-only listing sweeps nothing', () => {
    const gone = leavePresence('process-', goneProcessOwner());
    const marker = writeProductMigrationMarker(runtime);

    expect(listProductPresence(runtime, { sweep: false })).toEqual([]);
    expect(existsSync(gone)).toBe(true);
    marker.release();
  });
});
