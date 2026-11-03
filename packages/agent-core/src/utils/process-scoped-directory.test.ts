/**
 * Scratch directories that belong to one process, asserted against a real filesystem.
 *
 * Every case sets a PERMISSIVE umask, for the reason `owner-only-store.test.ts` gives: a restrictive
 * inherited umask would make a mode assertion pass whether or not the mode was requested.
 *
 * The sweep cases inject this process's identity and the liveness and start-time probes, so each rule
 * is exercised without real pids; the last cases run real processes with the default probes.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { hostname, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProcessScopedDirectory,
  processScopedDirectoryPrefix,
  sweepStaleProcessScopedDirectories,
  type ISweepProcessScopedDirectoriesOptions,
} from './process-scoped-directory.js';

import type { IProcessIdentity } from './process-identity.js';

const PREFIX = 'scratch-';
/** The owner record's on-disk name and shape are a contract with directories earlier runs left. */
const OWNER_RECORD = '.owner.json';

let root: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'process-scoped-')));
});

afterEach(() => {
  process.umask(previousUmask);
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const mode = (path: string): number => statSync(path).mode & 0o7777;

/** This process, as the injected probes describe it. */
const HERE: IProcessIdentity = {
  pid: 5000,
  startTime: 'started-5000',
  bootId: 'boot-a',
  pidNamespace: 'pid:[4026531836]',
  hostname: 'host-a',
  machineId: 'machine-a',
};

/**
 * Another Linux machine sharing the state root (a home directory over NFS): its own boot, but the
 * same initial pid namespace number every Linux kernel reports.
 */
const OTHER_MACHINE: IProcessIdentity = {
  ...HERE,
  pid: 4242,
  startTime: 'started-4242',
  bootId: 'boot-b',
  hostname: 'host-b',
  machineId: 'machine-b',
};

/** A directory exactly as `owner`'s run would have left it: named for its pid, record first. */
function leftBy(owner: IProcessIdentity, suffix = 'abc123'): string {
  const path = join(root, `${processScopedDirectoryPrefix(PREFIX, owner.pid)}${suffix}`);
  mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(path, OWNER_RECORD), JSON.stringify(owner), { mode: 0o600 });
  writeFileSync(join(path, 'secret.txt'), 'conversation content');
  return path;
}

/** Probes for a world in which exactly the pids in `live` run, each with the given start time. */
function world(
  live: Readonly<Record<number, string | undefined>>,
  current: IProcessIdentity = HERE,
): ISweepProcessScopedDirectoriesOptions {
  return {
    current,
    isProcessAlive: (pid) => pid in live,
    readStartTime: (pid) => live[pid],
  };
}

describe('createProcessScopedDirectory', () => {
  it('makes an owner-only directory named for this process, tightening a wider parent', () => {
    const parent = join(root, 'parent');
    mkdirSync(parent, { mode: 0o755 });

    const directory = createProcessScopedDirectory(parent, PREFIX);

    expect(basename(directory)).toMatch(new RegExp(`^${PREFIX}${process.pid}-[A-Za-z0-9]{6}$`));
    if (process.platform !== 'win32') {
      expect(mode(directory)).toBe(0o700);
      expect(mode(parent)).toBe(0o700);
    }
  });

  it('records who owns the directory before anything else goes in, owner-only', () => {
    const directory = createProcessScopedDirectory(join(root, 'parent'), PREFIX);

    expect(readdirSync(directory)).toEqual([OWNER_RECORD]);
    const record = JSON.parse(
      readFileSync(join(directory, OWNER_RECORD), 'utf8'),
    ) as IProcessIdentity;
    expect(record.pid).toBe(process.pid);
    expect(record.hostname).toBe(hostname());
    if (process.platform === 'linux' || process.platform === 'darwin') {
      expect(record.startTime).toMatch(/\S/u);
      expect(record.bootId).toMatch(/\S/u);
    }
    if (process.platform === 'darwin') expect(record.machineId).toMatch(/^[0-9a-f]{32}$/u);
    if (process.platform === 'linux') expect(record.pidNamespace).toMatch(/^pid:\[\d+\]$/u);
    if (process.platform !== 'win32') expect(mode(join(directory, OWNER_RECORD))).toBe(0o600);
  });

  it('uses a host parent as it is when told the parent is already prepared', () => {
    const parent = join(root, 'host-parent');
    mkdirSync(parent, { mode: 0o755 });

    const directory = createProcessScopedDirectory(parent, PREFIX, { prepareParent: false });

    expect(existsSync(join(directory, OWNER_RECORD))).toBe(true);
    if (process.platform !== 'win32') expect(mode(parent)).toBe(0o755);
  });
});

describe('sweepStaleProcessScopedDirectories', () => {
  it('removes the directory of an owner that is gone from this boot and pid namespace', () => {
    const stale = leftBy({ ...HERE, pid: 4242, startTime: 'started-4242' });

    const removed = sweepStaleProcessScopedDirectories(root, PREFIX, world({}));

    expect(removed).toEqual([basename(stale)]);
    expect(existsSync(stale)).toBe(false);
  });

  it('removes a directory whose pid now belongs to a different process', () => {
    const recycled = leftBy({ ...HERE, pid: 4242, startTime: 'started-4242' });

    sweepStaleProcessScopedDirectories(root, PREFIX, world({ 4242: 'started-later' }));

    expect(existsSync(recycled)).toBe(false);
  });

  it('removes what an earlier run as pid 1 left, and keeps what this pid-1 run owns', () => {
    const pidOne: IProcessIdentity = { ...HERE, pid: 1, startTime: 'started-now' };
    const earlier = leftBy({ ...pidOne, startTime: 'started-earlier' }, 'early1');
    const own = leftBy(pidOne, 'own001');

    sweepStaleProcessScopedDirectories(root, PREFIX, world({ 1: 'started-now' }, pidOne));

    expect(existsSync(earlier)).toBe(false);
    expect(existsSync(own)).toBe(true);
  });

  it('removes what this machine left in an earlier boot, even where its pid and start time match a live process', () => {
    const beforeReboot = leftBy({
      ...HERE,
      pid: 4242,
      startTime: 'started-4242',
      bootId: 'boot-0',
    });

    sweepStaleProcessScopedDirectories(root, PREFIX, world({ 4242: 'started-4242' }));

    expect(existsSync(beforeReboot)).toBe(false);
  });

  it('keeps the live directory of another machine sharing the state root, though its boot differs and its pid is not running here', () => {
    const otherMachine = leftBy(OTHER_MACHINE);

    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}))).toEqual([]);

    expect(existsSync(otherMachine)).toBe(true);
  });

  it('keeps a directory from a machine that differs in host name or machine id alone, whatever its boot', () => {
    const sameBoot = { ...HERE, pid: 4242, startTime: 'started-4242' };
    const otherHost = leftBy({ ...sameBoot, hostname: 'host-b' }, 'host01');
    const otherId = leftBy({ ...sameBoot, machineId: 'machine-b' }, 'mach01');
    const otherHostNoBoot = leftBy(
      { ...sameBoot, hostname: 'host-b', bootId: undefined },
      'host02',
    );

    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}))).toEqual([]);

    for (const path of [otherHost, otherId, otherHostNoBoot]) expect(existsSync(path)).toBe(true);
  });

  it('keeps a directory whose record does not name its machine, even from an earlier boot', () => {
    const { hostname: _hostname, machineId: _machineId, ...unnamed } = HERE;
    const noMachine = leftBy({ ...unnamed, pid: 4242, bootId: 'boot-0' }, 'nomac1');

    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}))).toEqual([]);

    expect(existsSync(noMachine)).toBe(true);
  });

  it('keeps a directory whose machine id only one side could read, since that side may be another machine', () => {
    const { machineId: _machineId, ...hostOnly } = HERE;
    const earlierBoot = { pid: 4242, startTime: 'started-4242', bootId: 'boot-0' };

    const recordWithout = leftBy({ ...hostOnly, ...earlierBoot }, 'noid01');
    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}, HERE))).toEqual([]);
    expect(existsSync(recordWithout)).toBe(true);
    rmSync(recordWithout, { recursive: true });

    const recordWith = leftBy({ ...HERE, ...earlierBoot }, 'hasid1');
    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}, hostOnly))).toEqual([]);
    expect(existsSync(recordWith)).toBe(true);
  });

  it('keeps the directory of a live owner whatever its age, and this process own directory', () => {
    const live = leftBy({ ...HERE, pid: 4242, startTime: 'started-4242' }, 'live01');
    const own = leftBy(HERE, 'own001');

    const removed = sweepStaleProcessScopedDirectories(
      root,
      PREFIX,
      world({ 4242: 'started-4242' }),
    );

    expect(removed).toEqual([]);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(own)).toBe(true);
  });

  it('keeps a directory from another pid namespace on this boot, where its owner may be live', () => {
    const otherContainer = leftBy({ ...HERE, pid: 4242, pidNamespace: 'pid:[4026532999]' });

    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}))).toEqual([]);

    expect(existsSync(otherContainer)).toBe(true);
  });

  it('keeps a live pid whose start time cannot be read, since it may be the owner', () => {
    const unknown = leftBy({ ...HERE, pid: 4242, startTime: 'started-4242' });

    sweepStaleProcessScopedDirectories(root, PREFIX, world({ 4242: undefined }));

    expect(existsSync(unknown)).toBe(true);
  });

  it('falls back to the pid alone on the same host where the platform offers no boot, start time or machine id', () => {
    const bare: IProcessIdentity = { pid: 5000, hostname: 'host-a' };
    const dead = leftBy({ pid: 4242, hostname: 'host-a' }, 'dead01');
    const live = leftBy({ pid: 4243, hostname: 'host-a' }, 'live01');
    const elsewhere = leftBy({ pid: 4244, hostname: 'host-b' }, 'else01');

    sweepStaleProcessScopedDirectories(root, PREFIX, world({ 4243: undefined }, bare));

    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(elsewhere)).toBe(true);
  });

  it('keeps a directory whose owner record is missing, unreadable, foreign or a link', () => {
    const noRecord = join(root, `${PREFIX}4242-norec1`);
    mkdirSync(noRecord);
    const garbled = leftBy({ ...HERE, pid: 4243 }, 'garbl1');
    writeFileSync(join(garbled, OWNER_RECORD), '{not json');
    const mismatched = leftBy({ ...HERE, pid: 4244 }, 'mism01');
    writeFileSync(join(mismatched, OWNER_RECORD), JSON.stringify({ ...HERE, pid: 4245 }));
    const linked = join(root, `${PREFIX}4246-link01`);
    mkdirSync(linked);
    writeFileSync(join(root, 'elsewhere.json'), JSON.stringify({ ...HERE, pid: 4246 }));
    symlinkSync(join(root, 'elsewhere.json'), join(linked, OWNER_RECORD));

    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}))).toEqual([]);

    for (const path of [noRecord, garbled, mismatched, linked]) expect(existsSync(path)).toBe(true);
  });

  it('leaves names it did not create, other prefixes, files and symbolic links alone', () => {
    const dead = { ...HERE, pid: 4242 };
    const outside = join(root, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, OWNER_RECORD), JSON.stringify(dead));
    const kept = [
      join(root, `${PREFIX}notapid-abc123`),
      join(root, `${PREFIX}4242-short`),
      join(root, `other-4242-abc123`),
      join(root, `${PREFIX}4242-abc123.extra`),
    ];
    for (const path of kept) {
      mkdirSync(path);
      writeFileSync(join(path, OWNER_RECORD), JSON.stringify(dead));
    }
    const file = join(root, `${PREFIX}4242-file01`);
    writeFileSync(file, 'x');
    const link = join(root, `${PREFIX}4242-link01`);
    symlinkSync(outside, link);
    writeFileSync(join(outside, 'precious.txt'), 'must survive');

    expect(sweepStaleProcessScopedDirectories(root, PREFIX, world({}))).toEqual([]);

    for (const path of [...kept, file, link]) expect(existsSync(path)).toBe(true);
    expect(existsSync(join(outside, 'precious.txt'))).toBe(true);
  });

  it('answers nothing for a parent that does not exist', () => {
    expect(sweepStaleProcessScopedDirectories(join(root, 'absent'), PREFIX)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'skips a directory it cannot remove and still removes the others',
    () => {
      const stuck = leftBy({ ...HERE, pid: 4242 }, 'aaaaaa');
      const locked = join(stuck, 'locked');
      mkdirSync(locked);
      writeFileSync(join(locked, 'inner.txt'), 'x');
      chmodSync(locked, 0o500);
      const second = leftBy({ ...HERE, pid: 4241 }, 'bbbbbb');
      try {
        const removed = sweepStaleProcessScopedDirectories(root, PREFIX, world({}));

        expect(removed).toEqual([basename(second)]);
        expect(existsSync(stuck)).toBe(true);
        expect(existsSync(second)).toBe(false);
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );
});

describe('the sweep with real processes and the default probes', () => {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const moduleUrl = pathToFileURL(
    fileURLToPath(new URL('./process-scoped-directory.ts', import.meta.url)),
  ).href;
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  /** A real process that makes a scratch directory, reports it, and stays alive until killed. */
  async function holder(parent: string): Promise<{ child: ChildProcess; directory: string }> {
    const script = [
      `import { createProcessScopedDirectory } from ${JSON.stringify(moduleUrl)};`,
      `const directory = createProcessScopedDirectory(process.argv[1], ${JSON.stringify(PREFIX)});`,
      "process.stdout.write(directory + '\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const child = spawn(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, parent],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    children.push(child);
    const directory = await new Promise<string>((resolve, reject) => {
      let out = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.includes('\n')) resolve(out.trim());
      });
      child.once('exit', (code, signal) => reject(new Error(`holder ended (${code}, ${signal})`)));
    });
    return { child, directory };
  }

  it('keeps a live process directory and removes the one a killed process left', async () => {
    const live = await holder(root);
    const dead = await holder(root);
    const ended = new Promise((resolve) => dead.child.once('exit', resolve));
    dead.child.kill('SIGKILL');
    await ended;

    const removed = sweepStaleProcessScopedDirectories(root, PREFIX);

    expect(removed).toEqual([basename(dead.directory)]);
    expect(existsSync(live.directory)).toBe(true);
    expect(existsSync(dead.directory)).toBe(false);
  }, 60_000);
});
