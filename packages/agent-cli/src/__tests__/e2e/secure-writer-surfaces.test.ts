/**
 * The surfaces that run as their own process in secure conversations, through the real composition
 * (`startCli` over the scripted provider), with the keyring file and the conversation mode choice a
 * `secure setup` and `secure enable` leave on disk. Print mode seals what it writes through a locked
 * key holder, never reads what it did not write, and never asks for a passphrase. The terminal starts
 * on the same locked holder and is the one surface that builds the unlock gate: `/unlock` opens the
 * keys in this process, `/lock` and the idle lock close them, and the model reaches neither. A
 * command, a plain state root and a subagent worker get no such holder.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { scriptedSession } from '@robota-sdk/agent-framework/testing';
import { FIXTURE_PASSPHRASE } from '@robota-sdk/agent-local-host/testing';
import { SUBAGENT_WORKER_MODE_FLAG } from '@robota-sdk/agent-subagent-runner';
import {
  createDefaultTuiCliAdapter,
  createNodeKeybindingsSource,
} from '@robota-sdk/agent-ui-terminal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { startCliCore } from '../../cli-core.js';
import { productKeyHolder } from '../../product/session-sealing.js';
import { createThemeSurface } from '../../startup/theme-surface.js';
import { createTestProductRuntime } from '../helpers/product-runtime.js';
import { probeArgs } from '../helpers/probe-tool-args.js';
import {
  enableSecureConversations,
  resolveSecureRuntime,
} from '../helpers/secure-product-state.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { scriptedSecureTerminal } from '../../secure/__tests__/helpers.js';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';
import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ICommandModule } from '@robota-sdk/agent-framework';
import type {
  IInteractiveSession,
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface/session';
import type { ITuiCliAdapter } from '@robota-sdk/agent-ui-terminal';

const worker = vi.hoisted(() => ({ runSubagentWorkerMain: vi.fn() }));
vi.mock('@robota-sdk/agent-subagent-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-subagent-runner')>()),
  runSubagentWorkerMain: worker.runSubagentWorkerMain,
}));

// What would open a passphrase prompt or build the local unlock gate is counted, and still real.
const gate = vi.hoisted(() => ({
  terminals: 0,
  custodies: 0,
  /** What the secret terminal is while a test plays the person typing the passphrase. */
  session: undefined as unknown,
}));
vi.mock('../../secure/secure-terminal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../secure/secure-terminal.js')>();
  return {
    ...actual,
    openSecureTerminal: (...args: Parameters<typeof actual.openSecureTerminal>) => {
      gate.terminals += 1;
      return (
        (gate.session as ReturnType<typeof actual.openSecureTerminal>) ??
        actual.openSecureTerminal(...args)
      );
    },
  };
});
// An `open` link is read and applied here, which rewrites the argument list the way the real one does.
const launch = vi.hoisted(() => ({ apply: undefined as undefined | (() => unknown) }));
vi.mock('../../launch-intent/open-invocation-host.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../launch-intent/open-invocation-host.js')>();
  return {
    ...actual,
    applyLaunchInvocation: (...args: Parameters<typeof actual.applyLaunchInvocation>) =>
      launch.apply === undefined ? actual.applyLaunchInvocation(...args) : launch.apply(),
  };
});
vi.mock('../../product/key-custody.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../product/key-custody.js')>();
  return {
    ...actual,
    productKeyCustody: (...args: Parameters<typeof actual.productKeyCustody>) => {
      gate.custodies += 1;
      return actual.productKeyCustody(...args);
    },
  };
});

// Each composition in this process leaves its exit handler behind, which a binary composes once.
process.setMaxListeners(process.getMaxListeners() + 40);

const testHost = createTestFrameworkHost();
const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-secure-writer-')));
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;
const PROMPT = 'PROMPT-CANARY-writer-surface-7c1e';
const ANSWER = 'ANSWER-CANARY-writer-surface-7c1e';
const REFUSAL =
  'Secure conversation sealing key holder is unavailable; no conversation store may open.';

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

/** The terminal UI's entry points, with the parts that would take over this process replaced by spies. */
function spiedPresentation() {
  return {
    createThemeSurface,
    createNodeKeybindingsSource,
    createDefaultTuiCliAdapter,
    renderApp: vi.fn(() => {
      throw new Error('the terminal UI was mounted');
    }),
    renderSupervisedSessionView: vi.fn(),
    renderAttachedApp: vi.fn(),
    installTuiProcessGuards: vi.fn(),
    setLiveChannel: vi.fn(),
  };
}

/** What the terminal UI is given to mount, which a test reads instead of mounting it. */
interface IMountedOptions {
  readonly cliAdapter: ITuiCliAdapter;
  readonly sessionStore: IInteractiveSessionStore;
  readonly commandModules: readonly ICommandModule[];
  readonly transportRegistry: {
    getAll(): readonly { readonly transport: { readonly name: string } }[];
    startAll(): Promise<void>;
    stopAll(): Promise<unknown>;
  };
  /** What the terminal UI calls for each session it builds, which binds the transports. */
  readonly bindTransports: (session: IInteractiveSession) => Promise<void>;
}

/** The terminal UI's entry points with `renderApp` answering at once, keeping what it was given to mount. */
function mountedPresentation() {
  let mounted: IMountedOptions | undefined;
  const presentation = {
    ...spiedPresentation(),
    renderApp: vi.fn((options: IMountedOptions) => {
      mounted = options;
      return Promise.resolve();
    }),
  };
  return {
    presentation,
    options: (): IMountedOptions => {
      if (mounted === undefined) throw new Error('the terminal UI was not mounted');
      return mounted;
    },
  };
}

describe('the writer surfaces in secure conversations', () => {
  let project: string;
  let home: string;
  let runtime: ICliRuntimeContext;
  let stdout: string[];
  let stderr: string[];

  async function secureRuntime(options: { keyring?: boolean } = {}): Promise<ICliRuntimeContext> {
    const plain = createTestProductRuntime('test-product', { HOME: home });
    await enableSecureConversations(plain, options);
    return resolveSecureRuntime(plain);
  }

  /** Runs `argv` as a process would, over a fresh scripted provider; the exit code, or the error it threw. */
  async function run(
    argv: string[],
    options: {
      productRuntime?: ICliRuntimeContext;
      presentation?: object;
    } = {},
  ): Promise<{ exitCode: number | undefined; error: Error | undefined }> {
    process.argv = ['node', 'test-product', ...argv];
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    }) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderr.push(String(chunk));
      return true;
    }) as never);
    const startOptions = {
      productRuntime: options.productRuntime ?? runtime,
      providerDefinitions: [scriptedDefinition(createScriptedProvider([{ text: ANSWER }]))],
      projectAccess: await createTrustedWorkspaceProjectAccess(
        project,
        options.productRuntime ?? runtime,
      ),
    };
    try {
      if (options.presentation === undefined) await startCli(startOptions);
      else await startCliCore(startOptions, testHost, () => [], options.presentation as never);
      return { exitCode: undefined, error: undefined };
    } catch (error) {
      const match = /^process\.exit:(\d+)$/.exec(error instanceof Error ? error.message : '');
      if (match) return { exitCode: Number(match[1]), error: undefined };
      return { exitCode: undefined, error: error as Error };
    } finally {
      vi.mocked(process.stdout.write).mockRestore();
      vi.mocked(process.stderr.write).mockRestore();
    }
  }

  /** Every session record the user's store (under `userHome`) or the trusted project's keeps, by file name. */
  function sessionRecords(userHome = home): Map<string, Buffer> {
    const records = new Map<string, Buffer>();
    for (const root of [join(userHome, '.test-product'), join(project, '.test-product')]) {
      for (const sub of ['sessions', join('secure-v1', 'sessions')]) {
        const directory = join(root, sub);
        if (!existsSync(directory)) continue;
        for (const name of readdirSync(directory)) {
          if (/^session_.*\.json$/u.test(name))
            records.set(name, readFileSync(join(directory, name)));
        }
      }
    }
    return records;
  }

  beforeEach(async () => {
    project = join(TMP_BASE, `project-${Math.random().toString(36).slice(2)}`);
    home = join(TMP_BASE, `home-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(project, '.test-product'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(project, '.test-product', 'settings.json'),
      JSON.stringify({
        currentProvider: 'scripted',
        providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
      }),
      'utf8',
    );
    process.env.HOME = home;
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
    gate.terminals = 0;
    gate.custodies = 0;
    gate.session = undefined;
    launch.apply = undefined;
    worker.runSubagentWorkerMain.mockReset();
    runtime = await secureRuntime();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it('answers a prompt and seals the record to the keyring through a locked key holder', async () => {
    // With the terminal UI's entry points present, as in the real binary, so the gate could be built.
    const result = await run(['-p', PROMPT], { presentation: spiedPresentation() });

    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain(ANSWER);
    const holder = productKeyHolder(runtime);
    expect(holder).toBeDefined();
    expect(holder?.isUnlocked).toBe(false);
    const records = [...sessionRecords().values()];
    expect(records).toHaveLength(1);
    expect(records[0]!.subarray(0, 4).toString('latin1')).toBe('RSL1');
    expect(records[0]!.includes(Buffer.from(PROMPT))).toBe(false);
    expect(records[0]!.includes(Buffer.from(ANSWER))).toBe(false);
    // Nothing asked for a passphrase, and the local unlock gate was never built.
    expect(gate.terminals).toBe(0);
    expect(gate.custodies).toBe(0);
    expect(stderr.join('')).not.toMatch(/passphrase/iu);
  });

  it('persists nothing and still answers with --no-session-persistence', async () => {
    const result = await run(['-p', PROMPT, '--no-session-persistence']);

    expect(result.exitCode).toBe(0);
    expect(stdout.join('')).toContain(ANSWER);
    expect(sessionRecords().size).toBe(0);
    expect(gate.terminals).toBe(0);
  });

  it('runs a slash command in print mode, and has no /unlock for anyone to run', async () => {
    const context = await run(['-p', '/context prompt']);
    expect(context.exitCode).toBe(0);
    expect(stdout.join('')).toMatch(/context/iu);

    const unlock = await run(['-p', '/unlock']);
    expect(unlock.exitCode).toBe(1);
    expect(stdout.join('') + stderr.join('')).toContain('Unknown command "/unlock".');
    expect(productKeyHolder(runtime)?.isUnlocked).toBe(false);
    expect(gate.terminals).toBe(0);
  });

  it('never reads what it did not write: a continued session is said to be sealed and locked, and left alone', async () => {
    await run(['-p', PROMPT]);
    const [[name, before]] = [...sessionRecords()];
    gate.terminals = 0;

    const continued = await run(['-p', 'again', '-c']);

    expect(continued.exitCode).toBe(0);
    expect(stderr.join('')).toContain('1 saved session is sealed and locked; unlock to open it.');
    expect(sessionRecords().get(name!)!.equals(before)).toBe(true);
    expect(gate.terminals).toBe(0);
  });

  it('never reads what it did not write: a resumed session is refused without a prompt', async () => {
    await run(['-p', PROMPT]);
    const [[name, before]] = [...sessionRecords()];
    const id = name!.replace(/\.json$/u, '');
    gate.terminals = 0;

    const resumed = await run(['-p', 'again', '-r', id]);

    expect(resumed.exitCode).toBe(1);
    expect(stderr.join('')).toContain(`Session ${id} is sealed and locked; unlock to open it.`);
    expect(sessionRecords().get(name!)!.equals(before)).toBe(true);
    expect(gate.terminals).toBe(0);
  });

  it('keeps refusing every store when the keyring file is gone, with no plaintext fallback', async () => {
    const gone = createTestProductRuntime('test-product', {
      HOME: join(TMP_BASE, 'no-keyring-home'),
    });
    await enableSecureConversations(gone, { keyring: false });
    const withoutKeyring = resolveSecureRuntime(gone);
    mkdirSync(join(TMP_BASE, 'no-keyring-home'), { recursive: true });

    const result = await run(['-p', PROMPT], { productRuntime: withoutKeyring });

    expect(result.error?.message ?? stderr.join('')).toContain(REFUSAL);
    expect(productKeyHolder(withoutKeyring)).toBeUndefined();
    expect(stdout.join('')).not.toContain(ANSWER);
    expect(sessionRecords().size).toBe(0);
    rmSync(join(TMP_BASE, 'no-keyring-home'), { recursive: true, force: true });
  });

  describe('the terminal', () => {
    const CANARY = 'CANARY-terminal-record-5b3f';
    const record: IInteractiveSessionRecord = {
      id: 'session_terminal_canary',
      cwd: '/work',
      createdAt: '2026-11-26T00:00:00.000Z',
      updatedAt: '2026-11-26T00:00:00.000Z',
      messages: [],
      name: CANARY,
    };

    /** Starts the terminal, as the binary does, and hands back what it was given to mount. */
    async function startedTerminal() {
      const mounted = mountedPresentation();
      const result = await run([], { presentation: mounted.presentation });
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(mounted.presentation.renderApp).toHaveBeenCalledTimes(1);
      return mounted.options();
    }

    /** A session built from the commands the terminal composed, where a person's slash command can run. */
    function terminalSession(
      options: IMountedOptions,
      handovers = vi.fn(),
      turns: Parameters<typeof scriptedSession>[0]['turns'] = [{ text: 'done' }],
    ) {
      return {
        handovers,
        harness: scriptedSession({
          turns,
          cwd: project,
          commandModules: options.commandModules,
          terminalHandoff: {
            canHandoffTerminal: true,
            runWithTerminal: <T>(operation: () => Promise<T>): Promise<T> => {
              handovers();
              return operation();
            },
          },
        }),
      };
    }

    it('starts on a locked key holder with no passphrase prompt, and has the unlock gate', async () => {
      const options = await startedTerminal();

      const holder = productKeyHolder(runtime);
      expect(holder).toBeDefined();
      expect(holder?.isUnlocked).toBe(false);
      // The gate exists for the terminal, and nothing asked for a passphrase to start it.
      expect(gate.custodies).toBe(1);
      expect(gate.terminals).toBe(0);
      expect(stderr.join('')).not.toMatch(/passphrase/iu);
      expect(options.cliAdapter.keyCustody).toBeDefined();
      const commands = options.commandModules.flatMap((module) =>
        (module.systemCommands ?? []).map((command) => command.name),
      );
      expect(commands).toContain('unlock');
      expect(commands).toContain('lock');
    });

    it('seals what it writes, reads it back after /unlock, and refuses it again after /lock', async () => {
      const options = await startedTerminal();
      const holder = productKeyHolder(runtime)!;
      options.sessionStore.save(record);

      const file = [...sessionRecords().entries()].find(([name]) => name.includes(record.id));
      expect(file).toBeDefined();
      expect(file![1].subarray(0, 4).toString('latin1')).toBe('RSL1');
      expect(file![1].includes(Buffer.from(CANARY))).toBe(false);
      // Written while locked, so it cannot be read here yet.
      expect(options.sessionStore.load(record.id)).toMatchObject({ status: 'locked' });

      const person = scriptedSecureTerminal({ passphrase: FIXTURE_PASSPHRASE });
      gate.session = person.session;
      const { harness, handovers } = terminalSession(options);
      try {
        const unlocked = await harness.session.executeCommand('unlock', '');
        expect(unlocked?.success).toBe(true);
        expect(holder.isUnlocked).toBe(true);
        expect(handovers).toHaveBeenCalledTimes(1);
        expect(person.prompts()).toEqual(['Passphrase: ']);
        expect(person.everything()).not.toContain(FIXTURE_PASSPHRASE);
        const opened = options.sessionStore.load(record.id);
        expect(opened.status).toBe('valid');
        expect(JSON.stringify(opened)).toContain(CANARY);

        const locked = await harness.session.executeCommand('lock', '');
        expect(locked?.success).toBe(true);
        expect(holder.isUnlocked).toBe(false);
        expect(options.sessionStore.load(record.id)).toMatchObject({ status: 'locked' });
      } finally {
        await harness.dispose();
      }
    });

    /**
     * Runs `work` with the terminal's input and clock the test's own: stdin is a stream the test types
     * on, and time moves only when told, from before the keys open so the idle timer is controlled too.
     */
    async function withControlledTerminal(
      work: (typed: (text: string) => void, minutes: (count: number) => Promise<unknown>) => Promise<void>,
    ): Promise<void> {
      const original = Object.getOwnPropertyDescriptor(process, 'stdin')!;
      const input = new PassThrough();
      input.pause();
      Object.defineProperty(process, 'stdin', { configurable: true, value: input });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      try {
        await work(
          (text) => {
            input.emit('data', Buffer.from(text));
          },
          (count) => vi.advanceTimersByTimeAsync(count * 60_000),
        );
      } finally {
        vi.useRealTimers();
        Object.defineProperty(process, 'stdin', original);
      }
    }

    it('locks by itself after the idle bound, which a key typed at the terminal moves', async () => {
      const options = await startedTerminal();
      const holder = productKeyHolder(runtime)!;
      options.sessionStore.save(record);
      await withControlledTerminal(async (typed, minutes) => {
        await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
        await minutes(14);
        expect(holder.isUnlocked).toBe(true);
        // A key typed at the terminal: the idle bound now counts from here.
        typed('k');
        await minutes(14);
        expect(holder.isUnlocked).toBe(true);
        expect(options.sessionStore.load(record.id).status).toBe('valid');
        await minutes(2);
        expect(holder.isUnlocked).toBe(false);
        expect(options.sessionStore.load(record.id)).toMatchObject({ status: 'locked' });
      });
    });

    it('locks at the idle bound when nothing was typed since the unlock', async () => {
      await startedTerminal();
      const holder = productKeyHolder(runtime)!;
      await withControlledTerminal(async (_typed, minutes) => {
        await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
        await minutes(14);
        expect(holder.isUnlocked).toBe(true);
        await minutes(2);
        expect(holder.isUnlocked).toBe(false);
      });
    });

    it('is not asked to unlock by any tool or command the model runs, and offers it neither', async () => {
      const options = await startedTerminal();
      const holder = productKeyHolder(runtime)!;
      const handovers = vi.fn();
      // The tools as this session gives them to the model, read from a session built the same way.
      const census = terminalSession(options, handovers, [{ text: 'listed' }]);
      await census.harness.submit('list your tools');
      const tools = census.harness.session.getSession().getToolSchemas();
      await census.harness.dispose();
      expect(tools.length).toBeGreaterThan(0);
      const { harness } = terminalSession(options, handovers, [
        { toolCalls: tools.map((tool) => ({ name: tool.name, args: probeArgs(tool) })) },
        ...Array.from({ length: 20 }, () => ({ text: 'done' })),
      ]);
      try {
        await harness.submit('use every tool you have');
        expect(
          harness
            .toolCalls()
            .map((call) => call.name)
            .sort(),
        ).toEqual(tools.map((tool) => tool.name).sort());

        const offered = new SystemCommandExecutor(
          options.commandModules.flatMap((module) => [...(module.systemCommands ?? [])]),
        ).listModelInvocableCommands();
        expect(offered.length).toBeGreaterThan(0);
        expect(offered.map(({ name }) => name)).not.toContain('unlock');
        expect(offered.map(({ name }) => name)).not.toContain('lock');
        for (const { name } of offered) await harness.session.executeModelCommand(name, '');
        // Reached as the model's command route would reach them, the credential commands are not its.
        expect(await harness.session.executeModelCommand('unlock', '')).toBeNull();
        expect(await harness.session.executeModelCommand('lock', '')).toBeNull();
      } finally {
        await harness.dispose();
      }

      expect(handovers).not.toHaveBeenCalled();
      expect(gate.terminals).toBe(0);
      expect(holder.isUnlocked).toBe(false);
    }, 60_000);

    it('binds no WebSocket listener, so it starts instead of failing on the one the table refuses', async () => {
      const options = await startedTerminal();

      await options.bindTransports({} as IInteractiveSession);

      expect(options.transportRegistry.getAll()).toHaveLength(0);
      await expect(options.transportRegistry.startAll()).resolves.toBeUndefined();
      await options.transportRegistry.stopAll();
    });

    it('binds its WebSocket listener in a plain state root, as before', async () => {
      const plainHome = join(TMP_BASE, 'plain-terminal-home');
      mkdirSync(plainHome, { recursive: true });
      const plain = createTestProductRuntime('test-product', { HOME: plainHome });
      const mounted = mountedPresentation();

      const result = await run([], { productRuntime: plain, presentation: mounted.presentation });
      expect(result.error).toBeUndefined();
      const options = mounted.options();
      await options.bindTransports({} as IInteractiveSession);

      expect(options.transportRegistry.getAll().map((entry) => entry.transport.name)).toEqual([
        'ws',
      ]);
      expect(productKeyHolder(plain)).toBeUndefined();
      expect(options.cliAdapter.keyCustody).toBeUndefined();
      rmSync(plainHome, { recursive: true, force: true });
    });

    it('starts from an open link on the same locked holder, which reads as the terminal it starts', async () => {
      // What the link's host does on success: drop the two tokens, so the arguments read as a terminal.
      launch.apply = () => {
        process.argv.splice(2, 2);
        return { kind: 'launched', initialInput: 'link prompt' };
      };
      try {
        const mounted = mountedPresentation();
        const result = await run(['open', 'robota://open?v=1'], {
          presentation: mounted.presentation,
        });

        expect(result.error).toBeUndefined();
        expect(mounted.presentation.renderApp).toHaveBeenCalledTimes(1);
        expect(productKeyHolder(runtime)?.isUnlocked).toBe(false);
        expect(gate.custodies).toBe(1);
        expect(gate.terminals).toBe(0);
      } finally {
        launch.apply = undefined;
      }
    });

    it('refuses to start without its keyring file, with no holder and no mount', async () => {
      const gone = createTestProductRuntime('test-product', {
        HOME: join(TMP_BASE, 'no-keyring-terminal-home'),
      });
      await enableSecureConversations(gone, { keyring: false });
      const withoutKeyring = resolveSecureRuntime(gone);
      mkdirSync(join(TMP_BASE, 'no-keyring-terminal-home'), { recursive: true });
      const mounted = mountedPresentation();

      const result = await run([], {
        productRuntime: withoutKeyring,
        presentation: mounted.presentation,
      });

      expect(result.error?.message ?? stderr.join('')).toContain(REFUSAL);
      expect(productKeyHolder(withoutKeyring)).toBeUndefined();
      expect(mounted.presentation.renderApp).not.toHaveBeenCalled();
      expect(gate.custodies).toBe(0);
      rmSync(join(TMP_BASE, 'no-keyring-terminal-home'), { recursive: true, force: true });
    });
  });

  it.each([
    ['usage', ['usage']],
    ['a session listing, even with a print flag', ['session', 'list', '-p']],
  ])('gives %s no holder, so its stores still refuse', async (_what, argv) => {
    const result = await run(argv);

    expect(result.error?.message ?? stderr.join('')).toContain(REFUSAL);
    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(gate.terminals).toBe(0);
  });

  it('gives a plain state root no holder, and seals nothing', async () => {
    const plainHome = join(TMP_BASE, 'plain-home');
    mkdirSync(plainHome, { recursive: true });
    const plain = createTestProductRuntime('test-product', { HOME: plainHome });
    // `secure setup` made the keyring and `secure enable` has not run, so the mode is still plain.
    await enableSecureConversations(plain, { mode: false });

    const result = await run(['-p', PROMPT], { productRuntime: plain });

    expect(result.exitCode).toBe(0);
    expect(productKeyHolder(plain)).toBeUndefined();
    // The user's store, or the trusted project's where a host can write project state (Linux).
    const records = [...sessionRecords(plainHome).values()];
    expect(records).toHaveLength(1);
    expect(records[0]!.toString('utf8')).toContain(PROMPT);
    rmSync(plainHome, { recursive: true, force: true });
  });

  it('gives a subagent worker no holder: the worker entry runs and no CLI composition starts', async () => {
    process.argv = ['node', '/embedder/entry.js', SUBAGENT_WORKER_MODE_FLAG];

    const started = startCli({ productRuntime: runtime });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(worker.runSubagentWorkerMain).toHaveBeenCalledTimes(1);
    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(await Promise.race([started.then(() => 'settled'), Promise.resolve('pending')])).toBe(
      'pending',
    );
  });
});
