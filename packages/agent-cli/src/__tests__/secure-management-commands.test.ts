/**
 * The invocations that are no conversation surface — help, version, a parse error, the session
 * listing, the doctor, MCP management, an evaluation, the direct user-local command, and the three
 * project setup commands (`init`, `--configure`, `--configure-provider`) — run in secure
 * conversations without a key holder and without a session store ever being built for them. They go
 * through the real startup of a state root with secure mode on; the one thing the test replaces is
 * the process exit, so a command that ends there can be told apart.
 *
 * The commands that read saved conversations (`usage`, `usage export`, `session analyze`) are the
 * counter-case: their data is sealed and no command holds a key, so they say so and fail before
 * anything is built.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';
import { supportsWorkspaceProjectMutation } from '@robota-sdk/agent-framework/node';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { productKeyHolder } from '../product/session-sealing.js';
import { createProductUserSessionStore } from '../product/session-stores.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';
import { createTrustedWorkspaceProjectAccess } from './helpers/trusted-workspace-project-access.js';
import { enableSecureConversations, resolveSecureRuntime } from './helpers/secure-product-state.js';

const testHost = createTestFrameworkHost();

/** Every conversation store a process builds comes from the product factory; each attempt is recorded. */
const stores = vi.hoisted(() => ({ built: [] as string[] }));
vi.mock('../product/session-stores.js', async (original) => {
  const actual = await original<typeof import('../product/session-stores.js')>();
  const recorded =
    <A extends unknown[], R>(name: string, build: (...args: A) => R) =>
    (...args: A): R => {
      stores.built.push(name);
      return build(...args);
    };
  return {
    ...actual,
    createProductUserSessionStore: recorded('user', actual.createProductUserSessionStore),
    createProductProjectSessionStore: recorded('project', actual.createProductProjectSessionStore),
    createProductEditCheckpointStoreFactory: recorded(
      'checkpoints',
      actual.createProductEditCheckpointStoreFactory,
    ),
    createProductPromptHistoryFile: recorded('history', actual.createProductPromptHistoryFile),
    createProductToolResultSpillStore: recorded('spill', actual.createProductToolResultSpillStore),
  };
});
/** What the interactive setup is asked, and the answers a person at the terminal would type. */
const prompts = vi.hoisted(() => ({ answers: [] as Array<readonly [RegExp, string]>, asked: [] as string[] }));
vi.mock('../cli-input.js', async (original) => {
  const actual = await original<typeof import('../cli-input.js')>();
  return {
    ...actual,
    promptInput: async (question: string): Promise<string> => {
      prompts.asked.push(question);
      return prompts.answers.find(([pattern]) => pattern.test(question))?.[1] ?? '';
    },
  };
});
const { startCliCore } = await import('../cli-core.js');

const REFUSAL =
  'Secure conversation sealing key holder is unavailable; no conversation store may open.';
const roots: string[] = [];
const originalExitCode = process.exitCode;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  stores.built.length = 0;
  prompts.answers.length = 0;
  prompts.asked.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface IRunOptions {
  /** Variables the invocation sees beside the isolated home, e.g. the one an `--api-key-env` names. */
  readonly env?: Record<string, string>;
  /** A state root where secure conversations were never enabled. */
  readonly plain?: boolean;
  /** Trusted access to the project, with the mutation capability `init` is approved to use. */
  readonly trusted?: boolean;
  /** Puts something in the user's state root before the invocation starts. */
  readonly prepare?: (userRoot: string) => void;
}

/** Starts the CLI on `argv` in a fresh state root, secure unless `plain`. */
async function run(argv: readonly string[], options: IRunOptions = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-secure-management-')));
  roots.push(home);
  const project = join(home, 'project');
  mkdirSync(project);
  vi.stubEnv('HOME', home);
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  const base = createTestProductRuntime('test-product', { HOME: home, ...options.env });
  if (options.plain !== true) await enableSecureConversations(base);
  const runtime = options.plain === true ? base : resolveSecureRuntime(base);
  options.prepare?.(runtime.layout.userRoot);
  const access =
    options.trusted === true
      ? await createTrustedWorkspaceProjectAccess(project, runtime)
      : createRestrictedWorkspaceProjectAccess('untrusted');
  let out = '';
  let err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((out += String(text)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => ((err += String(text)), true));
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`);
  });
  process.exitCode = undefined;
  const previous = process.argv;
  process.argv = ['node', 'test-product', ...argv];
  try {
    const outcome = await startCliCore(
      {
        productRuntime: runtime,
        projectAccess: access,
        ...(access.status === 'trusted'
          ? {
              projectMutation: createWorkspaceProjectMutation(access.authority, {
                status: 'approved',
                purpose: 'initialize the test project',
              }),
            }
          : {}),
      },
      testHost,
      () => [],
    ).then(
      () => 'returned',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    return {
      runtime,
      home,
      project,
      outcome,
      out,
      err,
      exitCode: process.exitCode,
      built: [...stores.built],
    };
  } finally {
    process.argv = previous;
  }
}

describe('invocations that read no conversation, in secure conversations', () => {
  it.each([
    ['--help', ['--help'], 'Usage: test-product [options]'],
    ['-h', ['-h'], 'Usage: test-product [options]'],
    ['--version', ['--version'], 'test-product '],
  ])('%s prints and returns', async (_name, argv, expected) => {
    const result = await run(argv);

    expect(result.outcome).toBe('returned');
    expect(result.out).toContain(expected);
    expect(result.err).toBe('');
    expect(result.exitCode).toBeUndefined();
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('reports a parse error as the parser does, not as a refusal to open a store', async () => {
    const result = await run(['--no-such-option']);

    expect(result.outcome).toBe('exit 1');
    expect(result.err).toContain("Unknown option '--no-such-option'");
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it.each([
    ['usage --help', ['usage', '--help']],
    ['usage -h', ['usage', '-h']],
    ['usage export --help', ['usage', 'export', '--help']],
  ])('%s prints its help and builds no store', async (_name, argv) => {
    const result = await run(argv);

    expect(result.outcome).toBe('returned');
    expect(result.out).toContain('Usage:');
    expect(result.exitCode).toBe(0);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('lists live and supervised sessions and says the saved ones are sealed', async () => {
    const result = await run(['session', 'list']);

    expect(result.outcome).toBe('returned');
    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('Live processes (not linked to saved sessions):\n  (none)');
    expect(result.out).toContain(
      'Saved sessions (not linked to live processes):\n  Saved sessions are sealed in secure mode and are not listed here; run /unlock in the terminal, then /resume.',
    );
    expect(result.out).toContain(
      'Supervised sessions (owned, not linked to peers or saved records):\n  (none)',
    );
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('marks the saved sessions of the JSON listing as sealed, never as none', async () => {
    const result = await run(['session', 'list', '--format', 'json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      savedSealed: true,
      supervised: { status: 'available', sessions: [] },
    });
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('prints the help of the session listing', async () => {
    const result = await run(['session', 'list', '--help']);

    expect(result.out).toBe('Usage: test-product session list [--format text|json]\n');
    expect(result.exitCode).toBe(0);
    expect(result.built).toEqual([]);
  });

  it('answers a release of a session that holds no writer marker', async () => {
    const result = await run([
      'session',
      'release',
      'session_00000000-0000-4000-8000-000000000000',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('has no writer marker; nothing to release.');
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('diagnoses with the doctor and composes no store, so no check fails for want of a key holder', async () => {
    const result = await run(['doctor']);

    expect(result.out).toContain('test-product doctor');
    expect(result.out).toContain('Settings layer');
    expect(result.out).not.toContain('Workspace composition');
    expect(`${result.out}${result.err}`).not.toContain('key holder');
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it.each([
    ['mcp login', ['mcp', 'login', 'nope'], 'No MCP server named "nope" is configured.'],
    ['mcp logout', ['mcp', 'logout', 'nope'], 'No MCP server named "nope" is configured.'],
    ['mcp add', ['mcp', 'add', 'exa'], 'runs only in an interactive terminal'],
  ])('routes %s to its own answer', async (_name, argv, expected) => {
    const result = await run(argv);

    expect(result.exitCode).toBe(1);
    expect(result.err).toContain(expected);
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('runs an evaluation to its own failure for a definition that is not there', async () => {
    const result = await run(['eval', 'missing-definition.json']);

    expect(result.exitCode).toBe(1);
    expect(result.err).toContain('Failed to load eval definition');
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('runs the direct user-local command to its own usage', async () => {
    const result = await run(['user-local']);

    expect(result.outcome).toBe('exit 1');
    expect(result.err).toContain('Usage: user-local');
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('resets the configuration without a key holder, as it needs none', async () => {
    const result = await run(['--reset', '--yes']);

    expect(result.outcome).toBe('returned');
    expect(result.err).not.toContain(REFUSAL);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });
});

/** What a command that totals or analyses saved conversations says in secure mode, in full. */
const sealed = (command: string): string =>
  `\`test-product ${command}\` reads saved conversations, which are sealed in secure mode; open them in the terminal after /unlock.\n`;

describe('commands that read saved conversations, in secure conversations', () => {
  it.each([
    ['usage', ['usage'], 'usage'],
    ['usage --format json', ['usage', '--format', 'json'], 'usage'],
    ['usage --period 30d', ['usage', '--period', '30d'], 'usage'],
    ['usage --bogus', ['usage', '--bogus'], 'usage'],
    ['usage -p', ['usage', '-p'], 'usage'],
    ['usage export', ['usage', 'export', '--endpoint', 'http://127.0.0.1:9'], 'usage export'],
    [
      'usage export --signal traces',
      ['usage', 'export', '--signal', 'traces', '--endpoint', 'http://127.0.0.1:9'],
      'usage export',
    ],
    ['session analyze', ['session', 'analyze'], 'session analyze'],
    ['session analyze --usage', ['session', 'analyze', '--usage'], 'session analyze'],
    ['session analyze --last 2', ['session', 'analyze', '--last', '2'], 'session analyze'],
    [
      'session analyze --session <id>',
      ['session', 'analyze', '--session', 'session_00000000-0000-4000-8000-000000000000'],
      'session analyze',
    ],
  ])(
    '%s says its conversations are sealed, before any store is built',
    async (_name, argv, command) => {
      const result = await run(argv);

      expect(result.outcome).toBe('returned');
      expect(result.exitCode).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toBe(sealed(command));
      expect(result.err).not.toContain(REFUSAL);
      expect(result.built).toEqual([]);
      expect(productKeyHolder(result.runtime)).toBeUndefined();
    },
  );

  it.each([
    ['usage --help', ['usage', '--help']],
    ['usage export --help', ['usage', 'export', '--help']],
  ])('keeps the help of %s', async (_name, argv) => {
    const result = await run(argv);

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('Usage:');
    expect(result.err).toBe('');
    expect(result.built).toEqual([]);
  });

  it('leaves the store factory its own refusal, for any other path to a store', async () => {
    const result = await run(['--version']);

    expect(() => createProductUserSessionStore(result.runtime)).toThrow(REFUSAL);
  });

  it('prints the report in plain conversations, as before, not the sealed line', async () => {
    const result = await run(['usage'], { plain: true });

    expect(result.exitCode).toBe(0);
    expect(result.out).toContain('Personal usage');
    expect(result.err).not.toContain('sealed in secure mode');
  });
});

describe('project setup commands, in secure conversations', () => {
  const PROFILE = [
    '--configure-provider',
    'work',
    '--type',
    'openai',
    '--model',
    'gpt-test',
    '--api-key-env',
    'TEST_PROVIDER_KEY',
  ];
  const ENV = { TEST_PROVIDER_KEY: 'test-credential' };

  /** What a conversation store would leave in a state root, or a presence marking a process that built one. */
  const conversationDirectories = (runtime: { layout: { userRoot: string } }): string[] =>
    ['sessions', 'secure-v1', 'presence'].filter((name) =>
      existsSync(join(runtime.layout.userRoot, name)),
    );

  it('saves a provider profile, builds no store and is given no key holder', async () => {
    const result = await run(PROFILE, { env: ENV });
    const settingsPath = result.runtime.layout.userPaths.settings;

    expect(result.outcome).toBe('returned');
    expect(result.exitCode).toBeUndefined();
    expect(result.out).toBe(`Provider profile saved to ${settingsPath}\n`);
    expect(result.err).toBe('');
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).providers.work).toMatchObject({
      type: 'openai',
      model: 'gpt-test',
    });
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
    expect(conversationDirectories(result.runtime)).toEqual([]);
  });

  it('makes a saved profile the current one with --set-current, building no store', async () => {
    const result = await run([...PROFILE, '--set-current'], { env: ENV });

    expect(result.outcome).toBe('returned');
    expect(
      JSON.parse(readFileSync(result.runtime.layout.userPaths.settings, 'utf8')).currentProvider,
    ).toBe('work');
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('leaves a switch of the current profile to the terminal start it is, with its locked key holder', async () => {
    // `--provider <name> --set-current` is no setup command of its own: it starts the terminal.
    const result = await run(['--provider', 'work', '--set-current'], { env: ENV });

    expect(result.outcome).toContain('was not found');
    expect(productKeyHolder(result.runtime)).toBeDefined();
  });

  it('runs the interactive setup from its own prompts and builds no store', async () => {
    prompts.answers.push(
      [/Choose \[1-4\]/u, '1'],
      [/Provider \[1-7\]/u, '2'],
      [/OpenAI model: /u, 'gpt-scripted'],
      [/OpenAI API key/u, '$ENV:TEST_PROVIDER_KEY'],
      [/Response language/u, ''],
    );

    const result = await run(['--configure'], { env: ENV });
    const settingsPath = result.runtime.layout.userPaths.settings;

    expect(result.outcome).toBe('returned');
    expect(result.exitCode).toBeUndefined();
    expect(prompts.asked.length).toBeGreaterThanOrEqual(5);
    expect(result.out).toContain(`Config saved to ${settingsPath}`);
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).providers).toBeDefined();
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
    expect(conversationDirectories(result.runtime)).toEqual([]);
  });

  it('initializes a trusted project and builds no store', async () => {
    const result = await run(['init', '--yes'], { trusted: true });

    // Reaches the project's own writes, which a host that cannot prove a write stays under the
    // trusted root refuses (it is Linux that can): the refusal is the project's, never the store's.
    expect(result.out).toContain('test-product project initialization');
    expect(result.err).not.toContain(REFUSAL);
    if (supportsWorkspaceProjectMutation()) {
      expect(result.outcome).toBe('returned');
      expect(result.exitCode).toBeUndefined();
      expect(result.out).toContain('Created: AGENTS.md');
      expect(result.out).toContain('Initialization complete.');
      expect(existsSync(join(result.project, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(result.project, '.test-product', 'settings.json'))).toBe(true);
      expect(readFileSync(join(result.project, '.test-product', '.gitignore'), 'utf8')).toContain(
        'sessions/',
      );
    } else {
      expect(result.outcome).toBe('exit 1');
      expect(result.err).toContain('Project mutation requires stable root-anchored host support');
    }
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
    expect(conversationDirectories(result.runtime)).toEqual([]);
  });

  it('refuses to initialize a project that is not trusted, with its own message', async () => {
    const result = await run(['init', '--yes']);

    expect(result.outcome).toBe('exit 1');
    expect(result.err).toContain('Project initialization requires project access.');
    expect(result.err).not.toContain(REFUSAL);
    expect(existsSync(join(result.project, 'AGENTS.md'))).toBe(false);
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('stops at an unreadable settings file, which it neither repairs nor replaces', async () => {
    const result = await run(PROFILE, {
      env: ENV,
      prepare: (userRoot) => writeFileSync(join(userRoot, 'settings.json'), '{ not json'),
    });

    expect(result.outcome).toContain('contains invalid JSON');
    expect(result.out).toBe('');
    expect(readFileSync(result.runtime.layout.userPaths.settings, 'utf8')).toBe('{ not json');
    expect(result.built).toEqual([]);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('presents an unreadable organization policy and saves nothing', async () => {
    const result = await run(PROFILE, {
      env: ENV,
      prepare: (userRoot) => writeFileSync(join(userRoot, 'org-policy.json'), '{ not json'),
    });

    expect(result.outcome).toBe('exit 1');
    expect(result.err).toContain('org-policy.json');
    expect(result.out).toBe('');
    expect(existsSync(result.runtime.layout.userPaths.settings)).toBe(false);
    expect(result.built).toEqual([]);
  });

  it('leaves a profile saved together with a print run to the session, which still refuses first', async () => {
    // A print run goes on to run a session, which needs a store; nothing is saved before it refuses.
    const result = await run([...PROFILE, '-p', 'hello'], { env: ENV, trusted: true });

    expect(result.outcome).toBe(REFUSAL);
    expect(result.out).toBe('');
    expect(existsSync(result.runtime.layout.userPaths.settings)).toBe(false);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });

  it('leaves a profile saved together with a prompt to the session, which still refuses first', async () => {
    const result = await run([...PROFILE, 'hello'], { env: ENV, trusted: true });

    expect(result.outcome).toBe(REFUSAL);
    expect(existsSync(result.runtime.layout.userPaths.settings)).toBe(false);
    expect(productKeyHolder(result.runtime)).toBeUndefined();
  });
});

describe('project setup commands, in plain conversations', () => {
  const normalize = (text: string, home: string): string => text.replaceAll(home, '<home>');
  const PROFILE = [
    '--configure-provider',
    'work',
    '--type',
    'openai',
    '--model',
    'gpt-test',
    '--api-key-env',
    'TEST_PROVIDER_KEY',
  ];
  const ENV = { TEST_PROVIDER_KEY: 'test-credential' };

  it.each([
    ['a provider profile', PROFILE],
    ['a profile made current', [...PROFILE, '--set-current']],
  ])('saves %s with the same output and settings as in secure conversations', async (_name, argv) => {
    const plain = await run(argv, { env: ENV, plain: true });
    const secure = await run(argv, { env: ENV });

    expect(plain.outcome).toBe(secure.outcome);
    expect(plain.exitCode).toBe(secure.exitCode);
    expect(normalize(plain.out, plain.home)).toBe(normalize(secure.out, secure.home));
    expect(normalize(plain.err, plain.home)).toBe(normalize(secure.err, secure.home));
    expect(readFileSync(plain.runtime.layout.userPaths.settings, 'utf8')).toBe(
      readFileSync(secure.runtime.layout.userPaths.settings, 'utf8'),
    );
  });

  it('runs the interactive setup with the same prompts and result as in secure conversations', async () => {
    const answers = [
      [/Choose \[1-4\]/u, '1'],
      [/Provider \[1-7\]/u, '2'],
      [/OpenAI model: /u, 'gpt-scripted'],
      [/OpenAI API key/u, '$ENV:TEST_PROVIDER_KEY'],
      [/Response language/u, 'en'],
    ] as const;
    prompts.answers.push(...answers);
    const plain = await run(['--configure'], { env: ENV, plain: true });
    const plainAsked = [...prompts.asked];
    prompts.asked.length = 0;
    const secure = await run(['--configure'], { env: ENV });

    expect(plain.outcome).toBe('returned');
    expect(plainAsked.length).toBeGreaterThanOrEqual(5);
    expect(prompts.asked).toEqual(plainAsked);
    expect(normalize(plain.out, plain.home)).toBe(normalize(secure.out, secure.home));
    expect(readFileSync(plain.runtime.layout.userPaths.settings, 'utf8')).toBe(
      readFileSync(secure.runtime.layout.userPaths.settings, 'utf8'),
    );
  });

  it('initializes a trusted project with the same output and files as in secure conversations', async () => {
    const plain = await run(['init', '--yes'], { plain: true, trusted: true });
    const secure = await run(['init', '--yes'], { trusted: true });

    expect(plain.outcome).toBe(secure.outcome);
    expect(plain.exitCode).toBe(secure.exitCode);
    expect(normalize(plain.out, plain.home)).toBe(normalize(secure.out, secure.home));
    expect(normalize(plain.err, plain.home)).toBe(normalize(secure.err, secure.home));
    if (!supportsWorkspaceProjectMutation()) return;
    for (const file of ['AGENTS.md', '.test-product/settings.json', '.test-product/.gitignore']) {
      expect(readFileSync(join(plain.project, file), 'utf8')).toBe(
        readFileSync(join(secure.project, file), 'utf8'),
      );
    }
  });

  it('keeps its startup order: the stores are still built before a setup command runs', async () => {
    const result = await run(PROFILE, { env: ENV, plain: true });

    expect(result.outcome).toBe('returned');
    expect(result.built).toContain('user');
  });
});
