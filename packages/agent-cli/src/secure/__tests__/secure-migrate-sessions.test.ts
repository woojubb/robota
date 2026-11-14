/**
 * The sessions `secure migrate` sealed from plaintext: sealing says nothing about who wrote a
 * file any program of the user could have written, so they stay unverified unless the person, asked
 * once at the end of a finished run, marks them as theirs. Driven as a person at a terminal would, as
 * `secure-migrate.test.ts` drives the rest of the command.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { leaveProcessMarker } from '@robota-sdk/agent-core/testing';
import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework/node';
import { serializeKeyring } from '@robota-sdk/agent-keyring';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { approveTestWorkspace } from '../../__tests__/helpers/approve-test-workspace.js';
import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';
import { workspaceRootBrokerEndpoint } from '../../startup/workspace-root-broker-process.js';
import { resolveCliRuntimeContext } from '../../startup/product-bootstrap.js';
import { writeProductConversationMode } from '../conversation-mode-state.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { KeyHolderArtifactSealer } from '@robota-sdk/agent-local-host';
import { KeyHolder } from '@robota-sdk/agent-local-host';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import { runSecureCommand, type ISecureCommandOptions } from '../secure-command.js';
import {
  acceptMigratedQuestion,
  createMigrationSteps,
  migratedUnverifiedMessage,
  type IMigrationStep,
} from '../secure-migrate.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring, scriptedSecureTerminal } from './helpers.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';

const CANARY = 'CANARY-5c2a-migrated-session';

let home: string;
let runtime: ICliRuntimeContext;
let log: Array<readonly ['out' | 'err', string]>;
let broker: Awaited<ReturnType<typeof startTestBroker>> | undefined;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-migrate-sessions-')));
  mkdirSync(join(home, 'shared-tmp'));
  runtime = createTestProductRuntime('test-product', { HOME: home });
  overrideProductSecureMode(runtime, true);
  log = [];
});

afterEach(async () => {
  await broker?.close();
  broker = undefined;
  if (process.platform !== 'win32')
    rmSync(dirname(workspaceRootBrokerEndpoint(runtime)), { recursive: true, force: true });
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

function fileStore(): ReturnType<typeof createKeyringFileStore> {
  return createKeyringFileStore({
    path: runtime.layout.userPaths.keyring,
    root: runtime.layout.userRoot,
  });
}

async function installFixtureKeyring(): Promise<void> {
  const { keyring } = await fixtureKeyring();
  mkdirSync(runtime.layout.userPaths.secure, { recursive: true });
  writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
}

/** Runs `secure <args>` as a person at a terminal would, answering the plan with `answer`. */
async function secure(
  args: readonly string[],
  answer: string | undefined,
  overrides: Partial<ISecureCommandOptions> = {},
): Promise<{ code: number }> {
  const terminal = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE });
  const code = await runSecureCommand(args, {
    productRuntime: runtime,
    stdout: (text) => log.push(['out', text]),
    stderr: (text) => log.push(['err', text]),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    openTerminal: () => terminal.session,
    confirm: async (question) => {
      if (answer === undefined) throw new Error(`nothing to answer to: ${question}`);
      return answer;
    },
    // The leftovers step looks in a temporary directory of the test's own, never the shared one.
    migrationSteps: createMigrationSteps({ temporaryDirectory: join(home, 'shared-tmp') }),
    ...overrides,
  });
  return { code };
}

/** A git worktree under home holding plain project state, trusted. */
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
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  const brokerDirectory = process.platform === 'win32'
    ? join(runtime.layout.userRoot, 'root-broker') : dirname(endpoint);
  mkdirSync(brokerDirectory, { recursive: true, mode: 0o700 });
  broker = await startTestBroker(endpoint, brokerDirectory, runtime.layout.userPaths.workspaceTrust);
  if (await approveTestWorkspace(root, runtime) !== 0) throw new Error('live project approval failed');
  return root;
}

describe('the sessions a migration sealed from plaintext', () => {
  /** Two plain records, as a store that keeps them plain writes them. */
  function seedPlainSessions(): void {
    const store = new NodeSessionStore(runtime.layout.userPaths.sessions, { sealing: 'plain' });
    for (const id of ['plain_one', 'plain_two']) {
      store.save({
        id,
        cwd: join(home, 'work'),
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        messages: [],
      });
    }
  }

  /** Whose a newly unlocked process says each record is. */
  async function authorshipOf(ids: readonly string[]): Promise<unknown[]> {
    const holder = new KeyHolder({ store: fileStore(), policy: { idleMs: 0 } });
    await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const sealer = new KeyHolderArtifactSealer(holder);
    const store = new NodeSessionStore(runtime.layout.userPaths.sessions, {
      sealing: { sealer },
    });
    const seen = ids.map((id) => {
      const outcome = store.load(id);
      return outcome.status === 'valid' ? outcome.authorship : outcome.status;
    });
    sealer.dispose();
    holder.lock('explicit');
    return seen;
  }

  /** `secure migrate` with one answer per question, in order. */
  async function migrate(answers: readonly string[], interactive: boolean) {
    const questions: string[] = [];
    const queue = [...answers];
    const { code } = await secure(['migrate'], undefined, {
      interactive,
      confirm: async (question) => {
        questions.push(question);
        const answer = queue.shift();
        if (answer === undefined) throw new Error(`nothing to answer to: ${question}`);
        return answer;
      },
    });
    return { code, questions };
  }

  it('imports verified sealed user records before enabling the dedicated store', async () => {
    await installFixtureKeyring();
    seedPlainSessions();

    const { code } = await secure(['enable'], 'y', { interactive: false });

    expect(code, `${out()}\n${err()}`).toBe(0);
    expect(resolveCliRuntimeContext({
      productConfig: runtime.config,
      environment: runtime.environment,
    }).conversationMode).toBe('secure');
    for (const id of ['plain_one', 'plain_two']) {
      const source = readFileSync(join(runtime.layout.userPaths.sessions, `${id}.json`));
      const archive = readFileSync(join(runtime.layout.userRoot, 'secure-v1', 'sessions', `${id}.json`));
      expect(archive).toEqual(source);
      expect(archive.toString('utf8')).not.toContain(id);
    }
  });

  it('keeps both copies and preparation state on an archive collision, then resumes', async () => {
    await installFixtureKeyring();
    seedPlainSessions();
    writeProductConversationMode(runtime.layout.userRoot, 'plain', 'plain');
    const target = join(runtime.layout.userRoot, 'secure-v1', 'sessions', 'plain_one.json');
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, 'different existing bytes', { mode: 0o600 });

    const first = await secure(['enable'], 'y', { interactive: false });

    expect(first.code).toBe(5);
    expect(resolveCliRuntimeContext({
      productConfig: runtime.config,
      environment: runtime.environment,
    }).conversationMode).toBe('preparing');
    expect(readFileSync(target, 'utf8')).toBe('different existing bytes');
    expect(readFileSync(join(runtime.layout.userPaths.sessions, 'plain_one.json'), 'utf8')).not.toContain('plain_one');

    rmSync(target);
    const preparing = resolveCliRuntimeContext({
      productConfig: runtime.config,
      environment: runtime.environment,
    });
    const resumed = await secure(['enable'], 'y', { interactive: false, productRuntime: preparing });
    expect(resumed.code, `${out()}\n${err()}`).toBe(0);
    expect(readFileSync(target)).toEqual(readFileSync(join(runtime.layout.userPaths.sessions, 'plain_one.json')));
  });

  it('are offered once, at the end of a finished run, and a yes marks exactly them as yours', async () => {
    await installFixtureKeyring();
    seedPlainSessions();

    const { code, questions } = await migrate(['y', 'y'], true);

    expect(code).toBe(0);
    expect(questions).toEqual(['Migrate now? [y/N] ', acceptMigratedQuestion(2)]);
    expect(out()).toContain('Marked 2 migrated sessions as yours.');
    expect(await authorshipOf(['plain_one', 'plain_two'])).toEqual(['verified', 'verified']);
  });

  it('leave a session open in another process plain, naming it, and seal the rest', async () => {
    await installFixtureKeyring();
    seedPlainSessions();
    // A live process other than this one holds plain_two's writer marker.
    const { startTime: _ignored, ...here } = readCurrentProcessIdentity();
    const startTime = readProcessStartTime(process.ppid);
    leaveProcessMarker(join(runtime.layout.userPaths.sessions, 'claims'), 'plain_two', {
      ...here,
      pid: process.ppid,
      ...(startTime === undefined ? {} : { startTime }),
    });
    const before = readFileSync(join(runtime.layout.userPaths.sessions, 'plain_two.json'));

    await migrate(['y', 'y'], true);

    expect(out()).toMatch(/open in another process[^\n]*: plain_two\./);
    expect(readFileSync(join(runtime.layout.userPaths.sessions, 'plain_two.json'))).toEqual(before);
    expect((await authorshipOf(['plain_one']))[0]).not.toBe('locked');
  });

  it('stay unverified at anything but yes, and the run says each asks on its first resume', async () => {
    await installFixtureKeyring();
    seedPlainSessions();

    const { code, questions } = await migrate(['y', 'n'], true);

    expect(code).toBe(0);
    expect(questions).toEqual(['Migrate now? [y/N] ', acceptMigratedQuestion(2)]);
    expect(out()).toContain(migratedUnverifiedMessage(2));
    expect(await authorshipOf(['plain_one', 'plain_two'])).toEqual(['unverified', 'unverified']);
  });

  it('are not asked about with no one to answer: the run says they are unverified', async () => {
    await installFixtureKeyring();
    seedPlainSessions();

    const { code, questions } = await migrate(['y'], false);

    expect(code).toBe(0);
    expect(questions).toEqual(['Migrate now? [y/N] ']);
    expect(out()).toContain(
      'The 2 migrated sessions are unverified: they came from plaintext files that any program of ' +
        'your user could have written. Each asks whether it is yours the first time it is resumed.',
    );
    expect(await authorshipOf(['plain_one', 'plain_two'])).toEqual(['unverified', 'unverified']);
  });

  it.skipIf(process.platform !== 'linux')(
    'include a trusted project’s records, which a yes marks as yours too',
    async () => {
      await installFixtureKeyring();
      const root = await trustedProject();
      const projectSessions = join(root, runtime.layout.projectStateDirectories.sessions);
      new NodeSessionStore(projectSessions, { sealing: 'plain' }).save({
        id: 'project_plain',
        cwd: root,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        messages: [],
      });

      const { questions } = await migrate(['y', 'y'], true);

      expect(questions).toEqual(['Migrate now? [y/N] ', acceptMigratedQuestion(1)]);
      const holder = new KeyHolder({ store: fileStore(), policy: { idleMs: 0 } });
      await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
      const sealer = new KeyHolderArtifactSealer(holder);
      const plain = Buffer.from(
        sealer.openBytes(readFileSync(join(projectSessions, 'project_plain.json')), {
          kind: 'session-record',
          id: 'project_plain',
        }),
      ).toString('utf8');
      sealer.dispose();
      holder.lock('explicit');
      // Tagged in place: the header only the unlocked keys make, in front of the same envelope.
      expect(plain).toMatch(/^robota-authorship\/v1 [A-Za-z0-9_-]{43}\n\{/u);
      expect(plain).toContain('"id": "project_plain"');
    },
  );

  it('are not asked about when the run sealed none', async () => {
    await installFixtureKeyring();

    const { questions } = await migrate(['y'], true);

    expect(questions).toEqual(['Migrate now? [y/N] ']);
    expect(out()).not.toContain('migrated session');
  });

  it('are said not to be marked when the keys locked before the marking, and stay unverified', async () => {
    await installFixtureKeyring();
    seedPlainSessions();
    let holder: KeyHolder | undefined;
    // A last step that only keeps the run's holder, so the keys can lock between the seal and the mark.
    const keepsHolder: IMigrationStep = {
      title: 'the holder',
      plan: () => ({ lines: [] }),
      run: async (context) => {
        holder = context.holder;
        return { lines: [], complete: true };
      },
    };
    const questions: string[] = [];

    const { code } = await secure(['migrate'], undefined, {
      interactive: true,
      migrationSteps: [
        ...createMigrationSteps({ temporaryDirectory: join(home, 'shared-tmp') }),
        keepsHolder,
      ],
      confirm: async (question) => {
        questions.push(question);
        if (question === acceptMigratedQuestion(2)) holder?.lock('explicit');
        return 'y';
      },
    });

    expect(code, `${out()}\n${err()}`).toBe(0);
    expect(questions).toEqual(['Migrate now? [y/N] ', acceptMigratedQuestion(2)]);
    expect(out()).toContain(
      '2 more were not marked: the keys locked during the run; resume each to mark it.',
    );
    expect(out()).not.toContain('at the next unlock');
    expect(await authorshipOf(['plain_one', 'plain_two'])).toEqual(['unverified', 'unverified']);
  });
});

describe('marking the migrated sessions when a batch cannot be marked', () => {
  it('marks the other batches, names the one it could not, and counts the locked apart from the changed', async () => {
    await installFixtureKeyring();
    const sealedBy = (
      title: string,
      migratedSessions: NonNullable<Awaited<ReturnType<IMigrationStep['run']>>['migratedSessions']>,
    ): IMigrationStep => ({
      title,
      plan: () => ({ lines: [`${title}: 1 plain file.`] }),
      run: async () => ({ lines: [], complete: true, migratedSessions }),
    });
    const failing = sealedBy('the failing store', {
      count: 2,
      adopt: () => {
        throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      },
    });
    const working = sealedBy('the working store', {
      count: 3,
      adopt: () =>
        ({ adopted: 1, locked: 1, changed: 1, unmarked: [] }) as unknown as ReturnType<
          NonNullable<Awaited<ReturnType<IMigrationStep['run']>>['migratedSessions']>['adopt']
        >,
    });

    const { code } = await secure(['migrate'], 'y', {
      migrationSteps: [failing, working],
      interactive: true,
    });

    expect(code, `${out()}\n${err()}`).toBe(0);
    expect(out(), err()).toContain('Marked 1 migrated session as yours.');
    expect(out()).toContain(
      '1 more was not marked: the keys locked during the run; resume it to mark it.',
    );
    expect(out()).toContain('1 other changed after this run sealed it and stays unverified.');
    expect(out()).toContain(
      'The 2 migrated sessions of the failing store could not be marked (Error); they stay unverified.',
    );
  });
});
