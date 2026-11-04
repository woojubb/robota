/**
 * `secure migrate [--dry-run]` and `secure compact` (#3679), driven as a person at a terminal would:
 * a scripted secret terminal for the passphrase and a scripted answer to the plan. Secure mode is
 * turned on through the predicate's own seam, since the persistent switch does not exist yet; real
 * child processes stand in for the other product processes a migration must see.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
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
import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework';
import {
  createKeyring,
  fingerprint,
  getSealingPublicKey,
  openArtifactKey,
  serializeKeyring,
  type IKeyring,
} from '@robota-sdk/agent-keyring';
import { NodePromptHistoryFile, NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { compactProductPromptHistory } from '../../product/session-stores.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { KeyHolderArtifactSealer } from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { createKeyringFileStore } from '../keyring-store.js';
import {
  SECURE_MODE_OFF,
  SECURE_USAGE,
  runSecureCommand,
  type ISecureCommandOptions,
} from '../secure-command.js';
import {
  EXIT_INCOMPLETE,
  MACOS_DURABILITY_CAVEAT,
  MIGRATION_CAVEAT,
  createMigrationSteps,
  type IMigrationStep,
} from '../secure-migrate.js';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  fixtureKeyring,
  scriptedSecureTerminal,
  withSwappedSealingKey,
  type IScriptedPerson,
  type IScriptedSecureTerminal,
} from './helpers.js';

import type { IProcessIdentity } from '@robota-sdk/agent-core/node';
import type { IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';
import type { ICliRuntimeContext } from '../../product/runtime-context.js';

vi.mock('@robota-sdk/agent-keyring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-keyring')>();
  return { ...actual, openArtifactKey: vi.fn(actual.openArtifactKey) };
});

vi.mock('../../product/session-stores.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../product/session-stores.js')>();
  return { ...actual, compactProductPromptHistory: vi.fn(actual.compactProductPromptHistory) };
});

const keyOpenings = vi.mocked(openArtifactKey);
const compactions = vi.mocked(compactProductPromptHistory);
const CANARY = 'CANARY-6f1e-typed-before-secure-mode';
const posixOnly = process.platform === 'win32';

let home: string;
let runtime: ICliRuntimeContext;
let log: Array<readonly ['out' | 'err', string]>;
const children: ChildProcess[] = [];

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-migrate-')));
  runtime = createTestProductRuntime('test-product', { HOME: home });
  overrideProductSecureMode(runtime, true);
  log = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  keyOpenings.mockClear();
  compactions.mockClear();
  for (const child of children.splice(0)) child.kill('SIGKILL');
  rmSync(home, { recursive: true, force: true });
});

const out = (): string =>
  log
    .filter(([stream]) => stream === 'out')
    .map(([, text]) => text)
    .join('');
const err = (): string =>
  log
    .filter(([stream]) => stream === 'err')
    .map(([, text]) => text)
    .join('');
const historyPath = (): string => runtime.layout.userPaths.history;
const presence = (): string => runtime.layout.userPaths.presence;
const markers = (): string[] =>
  existsSync(presence())
    ? readdirSync(presence()).filter((name) => name.startsWith('migration-'))
    : [];

function fileStore(
  durability?: Parameters<typeof createKeyringFileStore>[0]['durability'],
): ReturnType<typeof createKeyringFileStore> {
  return createKeyringFileStore({
    path: runtime.layout.userPaths.keyring,
    root: runtime.layout.userRoot,
    ...(durability === undefined ? {} : { durability }),
  });
}

function writeKeyringFile(keyring: IKeyring): void {
  mkdirSync(runtime.layout.userPaths.secure, { recursive: true });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
}

async function installFixtureKeyring(): Promise<IKeyring> {
  const { keyring } = await fixtureKeyring();
  writeKeyringFile(keyring);
  return keyring;
}

/** Runs `secure <args>` as a person at a terminal would, answering the plan with `answer`. */
async function secure(
  args: readonly string[],
  answer: string | undefined = undefined,
  person: IScriptedPerson = { passphrase: FIXTURE_PASSPHRASE },
  overrides: Partial<ISecureCommandOptions> = {},
): Promise<{ code: number; terminal: IScriptedSecureTerminal; questions: string[] }> {
  const terminal = scriptedSecureTerminal(person);
  const questions: string[] = [];
  const code = await runSecureCommand(args, {
    productRuntime: runtime,
    stdout: (text) => log.push(['out', text]),
    stderr: (text) => log.push(['err', text]),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    openTerminal: () => terminal.session,
    confirm: async (question) => {
      questions.push(question);
      if (answer === undefined) throw new Error(`nothing to answer to: ${question}`);
      return answer;
    },
    // The leftovers step looks in a temporary directory of the test's own, never the shared one.
    migrationSteps: createMigrationSteps({ temporaryDirectory: join(home, 'shared-tmp') }),
    ...overrides,
  });
  return { code, terminal, questions };
}

function entry(index: number): IPromptHistoryEntry {
  return {
    at: `2026-11-03T00:${String(index).padStart(2, '0')}:00.000Z`,
    sessionId: `s${index}`,
    project: '/work',
    text: `${CANARY} ${index}`,
  };
}

/**
 * A history as earlier runs left it: plain lines from before secure mode, then sealed lines from three
 * writer epochs (three processes that never unlocked, each sealing to the key the file holds).
 */
function seedHistory(): string[] {
  mkdirSync(runtime.layout.userRoot, { recursive: true });
  writeFileSync(historyPath(), `${JSON.stringify(entry(1))}\n${JSON.stringify(entry(2))}\n`, {
    mode: 0o600,
  });
  for (const index of [3, 4, 5]) {
    const writer = new KeyHolderArtifactSealer(new KeyHolder({ store: fileStore() }));
    new NodePromptHistoryFile(historyPath(), { sealing: { sealer: writer } }).append(entry(index));
    writer.dispose();
  }
  return [1, 2, 3, 4, 5].map((index) => entry(index).text);
}

/** The history read back by a newly unlocked process, and how many data keys that cost. */
async function readBack(): Promise<{ texts: string[]; keyOpenings: number }> {
  const holder = new KeyHolder({ store: fileStore(), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  const sealer = new KeyHolderArtifactSealer(holder);
  keyOpenings.mockClear();
  const texts: string[] = [];
  const file = new NodePromptHistoryFile(historyPath(), { sealing: { sealer } });
  for await (const block of file.read({ signal: new AbortController().signal })) {
    expect(block.skippedLines).toBe(0);
    texts.push(...block.entries.map((item) => item.text));
  }
  const openings = keyOpenings.mock.calls.length;
  sealer.dispose();
  holder.lock('explicit');
  return { texts: texts.reverse(), keyOpenings: openings };
}

/** Every entry under `home` with its size, modification time and mode bits, links not followed. */
function tree(): string[] {
  const listing: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      listing.push(`${path} ${stat.size} ${stat.mtimeMs} ${(stat.mode & 0o7777).toString(8)}`);
      if (stat.isDirectory()) walk(path);
    }
  };
  walk(home);
  return listing;
}

function age(path: string, milliseconds: number): void {
  const at = new Date(Date.now() - milliseconds);
  utimesSync(path, at, at);
}

/**
 * Another container's process on this machine, whose record carries no start time: neither alive nor
 * gone here.
 */
function otherContainerOwner(): IProcessIdentity {
  const { bootId, hostname, machineId } = readCurrentProcessIdentity();
  return {
    pid: 4242,
    ...(bootId === undefined ? {} : { bootId }),
    ...(hostname === undefined ? {} : { hostname }),
    ...(machineId === undefined ? {} : { machineId }),
    pidNamespace: 'pid:[4026531999]',
  };
}

/** A git worktree under home holding plain project state, trusted, with its trust store left at 0644. */
async function trustedProject(): Promise<string> {
  const root = join(home, 'project');
  mkdirSync(root);
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  const sessions = join(root, runtime.layout.projectStateDirectories.sessions);
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, 'project_one.json'), `{"note":"${CANARY}"}`);
  await createNodeWorkspaceTrustService(
    runtime.layout.userPaths.workspaceTrust,
    runtime.layout.projectStateDirectories,
  ).grant(root);
  return root;
}

/**
 * Everything a state root holds that a migration plans for: the history, a plain record and a crashed
 * write's temp file, a subagent transcript, a trust store an older build left group-readable with a
 * grant, a kept-aside hand-off, a gone process's presence and scratch, and an old `/editor` buffer.
 */
async function seedEverything(): Promise<void> {
  seedHistory();
  const sessions = runtime.layout.userPaths.sessions;
  new NodeSessionStore(sessions, { sealing: 'plain' }).save({
    id: 'user_saved',
    cwd: join(home, 'project'),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    messages: [],
  });
  writeFileSync(join(sessions, 'user_saved.json.4242.tmp'), CANARY);
  age(join(sessions, 'user_saved.json.4242.tmp'), 10 * 60 * 1000);
  const subagents = join(runtime.config.storage.logRoot, 'user_saved', 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(subagents, 'task_1.jsonl'), `{"note":"${CANARY}"}\n`);
  await trustedProject();
  chmodSync(runtime.layout.userPaths.workspaceTrust, 0o644);
  const aside = join(runtime.layout.userRoot, 'handoff', 'device_1');
  mkdirSync(aside, { recursive: true });
  writeFileSync(join(aside, 'h-1.json'), CANARY);
  leavePresence('process-', goneProcessOwner(), 'print');
  leaveProcessScopedDirectory(
    runtime.layout.userPaths.spill,
    'agent-tool-results-',
    goneProcessOwner(),
  );
  const editor = join(home, 'shared-tmp', 'test-product-editor-AbC123');
  mkdirSync(editor, { recursive: true });
  writeFileSync(join(editor, 'buffer.md'), CANARY);
  age(join(editor, 'buffer.md'), 2 * 24 * 60 * 60 * 1000);
  age(editor, 2 * 24 * 60 * 60 * 1000);
}

async function liveProcess(): Promise<IProcessIdentity> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
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

function leavePresence(prefix: string, owner: IProcessIdentity, mode?: string): string {
  const directory = leaveProcessScopedDirectory(presence(), prefix, owner);
  rmSync(join(directory, 'content.txt'));
  if (mode !== undefined) writeFileSync(join(directory, 'mode'), mode);
  return directory;
}

const normalized = (text: string): string => text.replace(/\s+/gu, ' ');

describe('secure migrate and secure compact while secure mode is off', () => {
  it.each([[['migrate']], [['migrate', '--dry-run']], [['compact']]])(
    'secure %j refuses with a fixed message before any terminal, and writes nothing',
    async (args) => {
      overrideProductSecureMode(runtime, false);
      await installFixtureKeyring();
      seedHistory();
      const before = tree();
      const openTerminal = vi.fn();

      const { code } = await secure(args, 'y', {}, { openTerminal });

      expect(code).toBe(1);
      expect(err()).toBe(SECURE_MODE_OFF('test-product', args[0] as 'migrate' | 'compact'));
      expect(out()).toBe('');
      expect(openTerminal).not.toHaveBeenCalled();
      expect(tree()).toEqual(before);
    },
  );

  it('are left out of the usage, which lists only what can run', () => {
    expect(SECURE_USAGE('test-product')).not.toMatch(/migrate|compact/);
  });

  it('setup stops saying secure mode is off once it is on', async () => {
    const answers = { newPassphrase: 'a long enough new passphrase' };
    overrideProductSecureMode(runtime, false);
    await secure(['setup'], undefined, answers);
    expect(out()).toContain('Secure mode is not turned on for sessions yet.');

    rmSync(runtime.layout.userPaths.secure, { recursive: true, force: true });
    log = [];
    overrideProductSecureMode(runtime, true);
    await secure(['setup'], undefined, answers);
    expect(out()).toContain('This only created the keyring.');
    expect(out()).not.toContain('Secure mode is not turned on');
  });
});

describe.skipIf(posixOnly)('secure migrate', () => {
  it('unlocks, prints the plan and the caveat on stdout, asks, and seals the history under one key', async () => {
    await installFixtureKeyring();
    const texts = seedHistory();
    expect((await readBack()).keyOpenings).toBe(3);
    const locks = vi.spyOn(KeyHolder.prototype, 'lock');

    const { code, terminal, questions } = await secure(['migrate'], 'y');

    expect(code).toBe(0);
    expect(questions).toEqual(['Migrate now? [y/N] ']);
    expect(out()).toContain(
      `Prompt history (${historyPath()}): 5 lines — 2 plain, 3 sealed, 0 that do not open here.`,
    );
    expect(out()).toContain('test-product secure migrate: done');
    expect(out()).toContain(
      `Prompt history (${historyPath()}): 5 entries sealed, one per line, under one key (2 were plain).`,
    );
    // The caveat, word for word, in the plan and again in the summary.
    expect(normalized(out()).split(normalized(MIGRATION_CAVEAT.join(' '))).length - 1).toBe(2);
    expect(MIGRATION_CAVEAT.join(' ')).toBe(
      'Removing plaintext does not erase copies in filesystem snapshots (Time Machine, APFS/btrfs/ZFS snapshots), backups, cloud or dotfile sync, git history, copies already exported (OpenTelemetry content logs, hooks), or blocks an SSD/flash device keeps after deletion. File names, sizes, times and session ids stay visible; migrated payload files keep content-derived names. Processes the migration cannot see (older builds still running) may write plaintext again; quit every product window first. Not touched: curated project memory (`MEMORY.md`, `topics/`, shared through the repository by design), untrusted or non-Linux project roots (listed), peer files, sandbox quarantine, desktop browser drafts, SDK spill directories (listed), other or relocated state roots, earlier copies of the keyring.',
    );
    expect(terminal.everything()).not.toMatch(/Caveat|Prompt history|plan/);
    expect(readFileSync(historyPath(), 'utf8')).not.toContain(CANARY);
    expect(await readBack()).toEqual({ texts, keyOpenings: 1 });
    expect(markers()).toEqual([]);
    expect(locks).toHaveBeenCalledWith('explicit');
  });

  it('needs the keyring unlocked: three wrong passphrases change nothing', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');

    const { code, questions } = await secure(['migrate'], 'y', { passphrase: OTHER_PASSPHRASE });

    expect(code).toBe(1);
    expect(err()).toContain('The keyring was not unlocked. Nothing was changed.');
    expect(questions).toEqual([]);
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
    expect(existsSync(presence())).toBe(false);
  });

  it('warns as verify does before anything else, and exits 2, when the stored sealing key was swapped', async () => {
    const keyring = await fixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring.keyring, stranger.keyring));
    seedHistory();

    const { code } = await secure(['migrate'], 'y');

    expect(code).toBe(2);
    expect(log[0]?.[0]).toBe('err');
    expect(log[0]?.[1]).toMatch(
      /^WARNING: the sealing public key in the keyring file was changed/u,
    );
    expect(err()).toContain(fingerprint(getSealingPublicKey(stranger.keyring)));
    expect(out()).toContain('test-product secure migrate: done');
    expect(readFileSync(historyPath(), 'utf8')).not.toContain(CANARY);
  });

  it('warns and exits 4, writing nothing, when the swapped key cannot be repaired', async () => {
    const keyring = await fixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring.keyring, stranger.keyring));
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');
    const ioError = (): never => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    };

    const { code, questions } = await secure(['migrate'], 'y', undefined, {
      store: fileStore({ syncFile: ioError }),
    });

    expect(code).toBe(4);
    expect(err()).toMatch(/WARNING/);
    expect(err()).toMatch(/still holds/);
    expect(questions).toEqual([]);
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
    expect(existsSync(presence())).toBe(false);
  });

  it('--dry-run unlocks, prints the plan, and writes nothing at all — not even its marker', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = tree();

    const { code, questions } = await secure(['migrate', '--dry-run']);

    expect(code).toBe(0);
    expect(questions).toEqual([]);
    expect(out()).toContain('test-product secure migrate --dry-run: plan');
    expect(out()).toContain('5 lines — 2 plain, 3 sealed');
    expect(out()).toContain('Dry run: nothing was changed.');
    expect(tree()).toEqual(before);
  });

  it('--dry-run over a fully seeded state root changes no byte, time or mode bit — not even the trust store an older build left readable', async () => {
    await installFixtureKeyring();
    await seedEverything();
    const before = tree();

    const { code } = await secure(['migrate', '--dry-run']);

    expect(code, out() + err()).toBe(0);
    expect(tree()).toEqual(before);
    expect(statSync(runtime.layout.userPaths.workspaceTrust).mode & 0o777).toBe(0o644);
  });

  it('--dry-run says the unlock repaired a swapped sealing key, the one write it made', async () => {
    const keyring = await fixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring.keyring, stranger.keyring));
    seedHistory();

    const { code } = await secure(['migrate', '--dry-run']);

    expect(code).toBe(2);
    expect(out()).not.toContain('Dry run: nothing was changed.');
    expect(out()).toContain(
      'Dry run: nothing else was changed; unlocking repaired the keyring file, as the warning says.',
    );
  });

  it('declines cleanly at anything but yes, and takes its marker away', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');

    const { code } = await secure(['migrate'], 'n');

    expect(code).toBe(1);
    expect(err()).toBe('Cancelled. Nothing was changed.\n');
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
    expect(markers()).toEqual([]);
  });

  it('refuses while another product process is alive, naming its pid, start time and mode', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');
    const other = await liveProcess();
    leavePresence('process-', other, 'interactive');

    const { code, questions } = await secure(['migrate'], 'y');

    expect(code).toBe(1);
    expect(err()).toContain(
      'Other test-product Agent processes are using the stored conversations',
    );
    expect(err()).toContain(`pid ${other.pid} (start time ${other.startTime}, interactive)`);
    expect(questions).toEqual([]);
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
    expect(markers()).toEqual([]);
  });

  it('refuses while another migration runs; and while it runs itself, its marker is what another sees', async () => {
    await installFixtureKeyring();
    seedHistory();
    const other = await liveProcess();
    leavePresence('migration-', other);

    const { code } = await secure(['migrate'], 'y');
    expect(code).toBe(1);
    expect(err()).toContain(`pid ${other.pid} (start time ${other.startTime}, secure migrate)`);

    children.splice(0).forEach((child) => child.kill('SIGKILL'));
    rmSync(presence(), { recursive: true, force: true });
    log = [];
    let seenByAnother: string | undefined;
    const second = await secure(['migrate'], undefined, undefined, {
      confirm: async () => {
        const [mine] = inspectProcessScopedDirectories(presence(), 'migration-');
        seenByAnother = mine?.liveness;
        return 'n';
      },
    });
    expect(second.code).toBe(1);
    expect(seenByAnother).toBe('alive');
  });

  it('lists a process it cannot check, and continues past it only when proceed is typed', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');
    // Another container's process, whose record carries no start time: neither alive nor gone here.
    leavePresence('process-', otherContainerOwner());

    const declined = await secure(['migrate'], 'y');
    expect(declined.code).toBe(1);
    expect(declined.questions[0]).toMatch(/Type proceed to migrate anyway/u);
    expect(out()).toContain('These processes could not be checked');
    expect(out()).toContain(
      'pid 4242 (start time not recorded, mode not recorded; another pid namespace, same boot)',
    );
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);

    log = [];
    const proceeded = await secure(['migrate'], 'proceed');
    expect(proceeded.code).toBe(0);
    expect(readFileSync(historyPath(), 'utf8')).not.toContain(CANARY);
  });

  it('labels a process left by another machine as such, with the host name its record carries', async () => {
    await installFixtureKeyring();
    seedHistory();
    // Its pid namespace and boot match this process's, so only the host name tells it apart: pids and
    // boots of another machine mean nothing here, and this must not read as "same boot".
    leavePresence('process-', { ...otherContainerOwner(), hostname: 'another-machine.example' }, 'serve');

    const declined = await secure(['migrate'], 'no');

    expect(declined.code).toBe(1);
    expect(out()).toContain('These processes could not be checked (another machine or container');
    expect(out()).toContain(
      'pid 4242 (start time not recorded, serve; on another machine, another-machine.example)',
    );
    expect(out()).not.toContain('another pid namespace');
  });

  it('labels a process of another machine whose host name was not recorded', async () => {
    await installFixtureKeyring();
    seedHistory();
    const { hostname: _recorded, ...withoutHostname } = otherContainerOwner();
    leavePresence('process-', withoutHostname, 'serve');

    await secure(['migrate'], 'no');

    expect(out()).toContain(
      'pid 4242 (start time not recorded, serve; on another machine, host name not recorded)',
    );
  });

  it('refuses past another migration it cannot check, and never offers proceed for one', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');
    leavePresence('migration-', otherContainerOwner());

    const { code, questions } = await secure(['migrate'], 'proceed');

    expect(code).toBe(1);
    expect(questions).toEqual([]);
    expect(err()).toContain('pid 4242 (start time not recorded, secure migrate');
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
  });

  it('labels a process of another pid namespace in the same boot as such', async () => {
    await installFixtureKeyring();
    seedHistory();
    leavePresence('process-', otherContainerOwner(), 'serve');

    await secure(['migrate'], 'no');

    expect(out()).toContain(
      'pid 4242 (start time not recorded, serve; another pid namespace, same boot)',
    );
  });

  it('does not call a process of another pid namespace one of the same boot when the boots were not compared', async () => {
    await installFixtureKeyring();
    seedHistory();
    const { hostname, machineId } = readCurrentProcessIdentity();
    leavePresence(
      'process-',
      {
        pid: 4242,
        ...(hostname === undefined ? {} : { hostname }),
        ...(machineId === undefined ? {} : { machineId }),
        pidNamespace: 'pid:[4026531999]',
      },
      'serve',
    );

    await secure(['migrate'], 'no');

    expect(out()).toContain('pid 4242 (start time not recorded, serve; another pid namespace)');
  });

  it('refuses while a compaction runs, as a compaction refuses while it runs', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');
    const other = await liveProcess();
    leavePresence('migration-', other, 'secure compact');

    const { code, questions } = await secure(['migrate'], 'y');

    expect(code).toBe(1);
    expect(questions).toEqual([]);
    expect(err()).toContain(`pid ${other.pid} (start time ${other.startTime}, secure compact)`);
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
  });

  it('is incomplete, exit 5, saying what to do first, when a record has another name or a transcript is a link', async () => {
    await installFixtureKeyring();
    seedHistory();
    const sessions = runtime.layout.userPaths.sessions;
    new NodeSessionStore(sessions, { sealing: 'plain' }).save({
      id: 'user_linked',
      cwd: '/work',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      messages: [],
    });
    const otherName = join(home, 'a-backup-of-the-record.json');
    linkSync(join(sessions, 'user_linked.json'), otherName);
    const subagents = join(runtime.config.storage.logRoot, 'user_saved', 'subagents');
    mkdirSync(subagents, { recursive: true });
    const target = join(home, 'elsewhere.jsonl');
    writeFileSync(target, `{"note":"${CANARY}"}\n`);
    symlinkSync(target, join(subagents, 'task_1.jsonl'));

    const { code } = await secure(['migrate'], 'y');

    expect(code, out()).toBe(EXIT_INCOMPLETE);
    const summary = out().slice(out().indexOf('test-product secure migrate: incomplete'));
    for (const refused of [join(sessions, 'user_linked.json'), join(subagents, 'task_1.jsonl')]) {
      expect(summary).toContain(
        `Not followed or replaced (links, files with another name, or not regular files), so what they hold is still there: ${refused}.`,
      );
    }
    expect(summary.split('Move each aside, or remove its other name, yourself; then run this again.')).toHaveLength(3);
    expect(readFileSync(otherName, 'utf8')).toContain('user_linked');
    expect(readFileSync(target, 'utf8')).toContain(CANARY);
  });

  it.skipIf(process.platform !== 'linux')(
    'is incomplete, exit 5, when a project record has another name or its pending memory candidates are a link',
    async () => {
      await installFixtureKeyring();
      seedHistory();
      const project = await trustedProject();
      const record = join(project, runtime.layout.projectStateDirectories.sessions, 'project_one.json');
      linkSync(record, join(home, 'a-backup-of-the-project-record.json'));
      const memory = join(project, runtime.layout.projectStateDirectories.memory);
      mkdirSync(memory, { recursive: true });
      const elsewhere = join(home, 'pending-elsewhere.json');
      writeFileSync(elsewhere, JSON.stringify({ version: 1, records: [{ text: CANARY }] }));
      symlinkSync(elsewhere, join(memory, 'pending.json'));

      const { code } = await secure(['migrate'], 'y');

      expect(code, out()).toBe(EXIT_INCOMPLETE);
      expect(out()).toContain(
        `so what they hold is still there: ${runtime.layout.projectStateDirectories.sessions}/project_one.json.`,
      );
      expect(out()).toContain(
        `Pending memory candidates (${runtime.layout.projectStateDirectories.memory}/pending.json): not a regular file, so not followed; move it aside yourself, then run this again.`,
      );
      expect(readFileSync(record, 'utf8')).toContain(CANARY);
      expect(readFileSync(elsewhere, 'utf8')).toContain(CANARY);
    },
  );

  it('continuing past an unchecked process with proceed deletes nothing that process may be using', async () => {
    await installFixtureKeyring();
    seedHistory();
    const sessions = runtime.layout.userPaths.sessions;
    mkdirSync(sessions, { recursive: true });
    const temp = join(sessions, 'user_saved.json.4242.tmp');
    writeFileSync(temp, CANARY);
    age(temp, 10 * 60 * 1000);
    const handoff = join(runtime.layout.userRoot, 'handoff', 'device_1', 'h-1.json');
    mkdirSync(join(handoff, '..'), { recursive: true });
    writeFileSync(handoff, CANARY);
    const project = process.platform === 'linux' ? await trustedProject() : undefined;
    const pending =
      project === undefined
        ? undefined
        : join(project, runtime.layout.projectStateDirectories.memory, 'pending.json');
    if (pending !== undefined) {
      mkdirSync(join(pending, '..'), { recursive: true });
      writeFileSync(pending, JSON.stringify({ version: 1, records: [{ text: CANARY }] }));
    }
    leavePresence('process-', otherContainerOwner());

    const { code } = await secure(['migrate'], 'proceed');

    // Plaintext is still there, so the run is not complete: it says to run again once the process it
    // could not check is gone.
    expect(code, out()).toBe(EXIT_INCOMPLETE);
    expect(out()).toContain('secure migrate: incomplete');
    expect(out()).toContain('run it again once those processes are gone');
    expect(existsSync(temp)).toBe(true);
    expect(existsSync(handoff)).toBe(true);
    if (pending !== undefined) expect(existsSync(pending)).toBe(true);
    expect(readFileSync(historyPath(), 'utf8')).not.toContain(CANARY);
  });

  it.each([
    ['a crashed write\'s temp file', 'temp'],
    ['a kept-aside hand-off', 'handoff'],
  ] as const)(
    'ends incomplete when proceed past an unchecked process leaves only %s',
    async (_label, kind) => {
      await installFixtureKeyring();
      seedHistory();
      const left =
        kind === 'temp'
          ? join(runtime.layout.userPaths.sessions, 'user_saved.json.4242.tmp')
          : join(runtime.layout.userRoot, 'handoff', 'device_1', 'h-1.json');
      mkdirSync(join(left, '..'), { recursive: true });
      writeFileSync(left, CANARY);
      age(left, 10 * 60 * 1000);
      leavePresence('process-', otherContainerOwner());

      const { code } = await secure(['migrate'], 'proceed');

      expect(code, out()).toBe(EXIT_INCOMPLETE);
      expect(existsSync(left)).toBe(true);
    },
  );

  it.runIf(process.platform === 'linux')(
    'ends incomplete when proceed past an unchecked process leaves only pending memory candidates',
    async () => {
      await installFixtureKeyring();
      seedHistory();
      const project = await trustedProject();
      const pending = join(project, runtime.layout.projectStateDirectories.memory, 'pending.json');
      mkdirSync(join(pending, '..'), { recursive: true });
      writeFileSync(pending, JSON.stringify({ version: 1, records: [{ text: CANARY }] }));
      leavePresence('process-', otherContainerOwner());

      const { code } = await secure(['migrate'], 'proceed');

      expect(code, out()).toBe(EXIT_INCOMPLETE);
      expect(out()).toContain('left as they are, since some processes could not be checked');
      expect(existsSync(pending)).toBe(true);
    },
  );

  it('still completes past an unchecked process when there is nothing for it to have left', async () => {
    await installFixtureKeyring();
    seedHistory();
    leavePresence('process-', otherContainerOwner());

    const { code } = await secure(['migrate'], 'proceed');

    expect(code, out()).toBe(0);
  });

  it('a plan that fails still ends with the status a repaired sealing key calls for', async () => {
    const keyring = await fixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring.keyring, stranger.keyring));
    const step: IMigrationStep = {
      title: 'the test store',
      plan: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
      run: async () => ({ lines: [], complete: true }),
    };

    const { code, questions } = await secure(['migrate'], 'y', undefined, {
      migrationSteps: [step],
    });

    expect(code).toBe(4);
    expect(questions).toEqual([]);
    expect(err()).toMatch(/WARNING/u);
    expect(err()).toContain('The plan could not be made (Error). Nothing was changed.');
    expect(markers()).toEqual([]);
  });

  it('tells the person that processes which said they could not mark themselves are invisible to it', async () => {
    await installFixtureKeyring();
    seedHistory();

    await secure(['migrate'], 'no');

    expect(normalized(out())).toContain(
      'including ones started by an older build and ones that said they could not mark themselves: those are not visible here',
    );
  });

  it('is incomplete, exit 5, when it must leave the history as it is', async () => {
    await installFixtureKeyring();
    mkdirSync(runtime.layout.userRoot, { recursive: true });
    const target = join(home, 'dotfiles-history.jsonl');
    writeFileSync(target, `${JSON.stringify(entry(1))}\n`);
    symlinkSync(target, historyPath());

    const { code } = await secure(['migrate'], 'y');

    expect(code).toBe(EXIT_INCOMPLETE);
    expect(out()).toContain('test-product secure migrate: incomplete');
    expect(out()).toMatch(/Prompt history \(.*\): left as it is, since it is not a regular file/u);
    expect(readFileSync(target, 'utf8')).toContain(CANARY);
  });

  it('says on macOS that its durability rests on a flush that does not empty the drive cache', async () => {
    await installFixtureKeyring();
    seedHistory();

    await secure(['migrate'], 'no', undefined, { platform: 'darwin' });
    const onDarwin = out();
    log = [];
    await secure(['migrate'], 'no', undefined, { platform: 'linux' });

    expect(onDarwin).toContain(MACOS_DURABILITY_CAVEAT);
    expect(out()).not.toContain(MACOS_DURABILITY_CAVEAT);
  });

  it('judges a crashed write’s temp file against when it started, in a directory nothing changed in since', async () => {
    await installFixtureKeyring();
    seedHistory();
    const sessions = runtime.layout.userPaths.sessions;
    mkdirSync(sessions, { recursive: true });
    const temp = join(sessions, 'deleted_one.json.4242.tmp');
    writeFileSync(temp, CANARY);
    age(temp, 10 * 60 * 1000);
    age(sessions, 10 * 60 * 1000);

    const { code } = await secure(['migrate'], 'y');

    expect(code, out()).toBe(0);
    expect(existsSync(temp)).toBe(false);
  });

  it('sweeps the presence of processes that are gone', async () => {
    await installFixtureKeyring();
    seedHistory();
    const gone = leavePresence('process-', goneProcessOwner(), 'print');

    const { code } = await secure(['migrate'], 'y');

    expect(code).toBe(0);
    expect(existsSync(gone)).toBe(false);
  });

  it('exits 5, saying to run it again, when a step leaves something plain', async () => {
    await installFixtureKeyring();
    const step: IMigrationStep = {
      title: 'the test store',
      plan: () => ({ lines: ['Test store: 1 plain file.'] }),
      run: async () => ({ lines: ['Test store: 1 file is still plain.'], complete: false }),
    };

    const { code } = await secure(['migrate'], 'y', undefined, { migrationSteps: [step] });

    expect(code).toBe(EXIT_INCOMPLETE);
    expect(out()).toContain('  Test store: 1 plain file.');
    expect(out()).toContain('test-product secure migrate: incomplete');
    expect(out()).toContain('run `test-product secure migrate` again to finish');
  });

  it('stops with exit 5, naming it, when a product process appears before a commit point', async () => {
    await installFixtureKeyring();
    let appeared: IProcessIdentity | undefined;
    let changed = false;
    const step: IMigrationStep = {
      title: 'the test store',
      plan: () => ({ lines: ['Test store: 1 plain file.'] }),
      run: async (context) => {
        appeared = await liveProcess();
        leavePresence('process-', appeared, 'serve');
        context.recheckPresence();
        changed = true;
        return { lines: [], complete: true };
      },
    };

    const { code } = await secure(['migrate'], 'y', undefined, { migrationSteps: [step] });

    expect(code).toBe(EXIT_INCOMPLETE);
    expect(changed).toBe(false);
    expect(out()).toContain('Stopped before changing the test store: 1 process started meanwhile:');
    expect(out()).toContain(`pid ${appeared?.pid} (start time ${appeared?.startTime}, serve)`);
  });
});

describe.skipIf(posixOnly)('secure compact', () => {
  it('unlocks and compacts the history under one key, under its marker, asking nothing', async () => {
    await installFixtureKeyring();
    const texts = seedHistory();
    const actual = (
      await vi.importActual<typeof import('../../product/session-stores.js')>(
        '../../product/session-stores.js',
      )
    ).compactProductPromptHistory;
    let markedWhileCompacting: string[] = [];
    compactions.mockImplementationOnce((productRuntime, holder, options) => {
      markedWhileCompacting = markers();
      return actual(productRuntime, holder, options);
    });

    const { code, questions } = await secure(['compact']);

    expect(code).toBe(0);
    expect(questions).toEqual([]);
    expect(out()).toBe(
      `Prompt history (${historyPath()}): 5 entries sealed, one per line, under one key (2 were plain).\n`,
    );
    expect(markedWhileCompacting).toHaveLength(1);
    expect(markers()).toEqual([]);
    expect(await readBack()).toEqual({ texts, keyOpenings: 1 });
  });

  it('refuses while another migration or compaction runs, and changes nothing', async () => {
    await installFixtureKeyring();
    seedHistory();
    const before = readFileSync(historyPath(), 'utf8');
    const other = await liveProcess();
    leavePresence('migration-', other);

    const { code } = await secure(['compact']);

    expect(code).toBe(1);
    expect(err()).toContain(`pid ${other.pid} (start time ${other.startTime}, secure migrate)`);
    expect(readFileSync(historyPath(), 'utf8')).toBe(before);
    expect(compactions).not.toHaveBeenCalled();
  });

  it('exits 5, saying how much was lost, when the catch-up fails after the swap', async () => {
    await installFixtureKeyring();
    seedHistory();
    compactions.mockResolvedValueOnce({
      status: 'compacted',
      entries: 5,
      fromPlain: 2,
      caughtUp: 0,
      carriedOver: 0,
      droppedTail: false,
      plainLinesAfter: 0,
      catchUpFailed: { unreadBytes: 42, reason: 'ArtifactLockedError' },
    });

    const { code } = await secure(['compact']);

    expect(code).toBe(EXIT_INCOMPLETE);
    expect(normalized(out())).toContain(
      'The catch-up stopped (ArtifactLockedError) with 42 bytes appended to the replaced history unread; those prompts are still in their session records.',
    );
  });

  it('exits 5 when a plain line reaches the new history while it catches up', async () => {
    await installFixtureKeyring();
    seedHistory();
    const actual = (
      await vi.importActual<typeof import('../../product/session-stores.js')>(
        '../../product/session-stores.js',
      )
    ).compactProductPromptHistory;
    let appended = false;
    compactions.mockImplementationOnce((productRuntime, holder) =>
      actual(productRuntime, holder, {
        pause: async () => {
          if (appended) return;
          appended = true;
          appendFileSync(historyPath(), `${JSON.stringify(entry(9))}\n`);
        },
      }),
    );

    const { code } = await secure(['compact']);

    expect(code).toBe(EXIT_INCOMPLETE);
    expect(out()).toMatch(/1 plain line reached it meanwhile/u);
  });

  it('says the history was removed, and puts nothing back, when it is deleted while being compacted', async () => {
    await installFixtureKeyring();
    seedHistory();
    const actual = (
      await vi.importActual<typeof import('../../product/session-stores.js')>(
        '../../product/session-stores.js',
      )
    ).compactProductPromptHistory;
    compactions.mockImplementationOnce((productRuntime, holder) =>
      actual(productRuntime, holder, { beforeCommit: () => rmSync(historyPath()) }),
    );

    const { code } = await secure(['compact']);

    expect(code).toBe(0);
    expect(out()).toBe(
      `Prompt history (${historyPath()}): removed while this compaction ran, so nothing was put in its place.\n`,
    );
    expect(existsSync(historyPath())).toBe(false);
  });

  it('refuses a history that is a symbolic link, and leaves it as it is', async () => {
    await installFixtureKeyring();
    mkdirSync(runtime.layout.userRoot, { recursive: true });
    const target = join(home, 'dotfiles-history.jsonl');
    writeFileSync(target, `${JSON.stringify(entry(1))}\n`);
    symlinkSync(target, historyPath());

    const { code } = await secure(['compact']);

    expect(code).toBe(EXIT_INCOMPLETE);
    expect(err()).toMatch(/left as it is, since it is not a regular file/u);
    expect(readFileSync(target, 'utf8')).toContain(CANARY);
  });
});
