/**
 * Print mode in secure conversations through the real composition (`startCli` over the scripted
 * provider), with the keyring file and the conversation mode choice a `secure setup` and `secure
 * enable` leave on disk. Print mode seals what it writes through a locked key holder, never reads what
 * it did not write, and never asks for a passphrase; the terminal, a command, a plain state root and
 * a subagent worker get no such holder.
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

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
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
import {
  enableSecureConversations,
  resolveSecureRuntime,
} from '../helpers/secure-product-state.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';
import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const worker = vi.hoisted(() => ({ runSubagentWorkerMain: vi.fn() }));
vi.mock('@robota-sdk/agent-subagent-runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-subagent-runner')>()),
  runSubagentWorkerMain: worker.runSubagentWorkerMain,
}));

// What would open a passphrase prompt or build the local unlock gate is counted, and still real.
const gate = vi.hoisted(() => ({ terminals: 0, custodies: 0 }));
vi.mock('../../secure/secure-terminal.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../secure/secure-terminal.js')>();
  return {
    ...actual,
    openSecureTerminal: (...args: Parameters<typeof actual.openSecureTerminal>) => {
      gate.terminals += 1;
      return actual.openSecureTerminal(...args);
    },
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
      presentation?: ReturnType<typeof spiedPresentation>;
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

  it('gives the terminal no holder, so it still refuses before anything mounts', async () => {
    const presentation = spiedPresentation();

    const result = await run([], { presentation });

    expect(result.error?.message).toContain(REFUSAL);
    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(presentation.renderApp).not.toHaveBeenCalled();
    expect(gate.custodies).toBe(0);
    expect(gate.terminals).toBe(0);
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
