import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * A served runtime (`--serve`, and a daemon's spawned child, which is also `--serve`) with
 * no usable provider configuration starts in setup mode instead of exiting. The TUI and print mode are
 * unchanged: they still exit with the same message.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrustedWorkspaceProjectAccess } from '../../__tests__/helpers/trusted-workspace-project-access.js';
import { promptInput } from '../../cli-input.js';
import { runInitCommand } from '../../init/init-command.js';
import { routeProjectSetup } from '../project-setup-routing.js';
import { createCliWorkspaceComposition } from '../workspace-project-composition.js';

import type { IStartCliOptions } from '../cli-options-types.js';
import type { IParsedCliArgs } from '../../utils/cli-args.js';
import type { ITerminalOutput, ISpinner } from '@robota-sdk/agent-core';
import type { IWorkspaceProjectMutation } from '@robota-sdk/agent-framework';

vi.mock('../../cli-input.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cli-input.js')>()),
  promptInput: vi.fn(() => Promise.resolve('')),
}));

// Both wrap the real function, so a test sees what the routing handed on or minted without
// replacing the behavior of the tests that run `init` for real.
vi.mock('../../init/init-command.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../init/init-command.js')>();
  return { ...actual, runInitCommand: vi.fn(actual.runInitCommand) };
});
vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  return {
    ...actual,
    createWorkspaceProjectMutation: vi.fn(actual.createWorkspaceProjectMutation),
  };
});

const NOOP_TERMINAL: ITerminalOutput = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: () => Promise.resolve(''),
  select: () => Promise.resolve(0),
  spinner: (): ISpinner => ({ stop: () => {}, update: () => {} }),
};

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-project-setup-routing-test-')));
const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

function baseArgs(overrides: Partial<IParsedCliArgs> = {}): IParsedCliArgs {
  return {
    positional: [],
    printMode: false,
    configure: false,
    configureProvider: undefined,
    setCurrent: false,
    serve: false,
    ...overrides,
  } as IParsedCliArgs;
}

/** A fresh project + user home with no provider ever configured, and no interactive terminal. */
function emptyWorkspace(name: string, { tty = false }: { tty?: boolean } = {}) {
  const project = join(TMP_BASE, `${name}-project`);
  const home = join(TMP_BASE, `${name}-home`);
  Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true });
  const productRuntime = createTestProductRuntime('test-product', { HOME: home });
  const workspace = createCliWorkspaceComposition({productRuntime,  cwd: project, userHome: home });
  return { cwd: project, workspace, productRuntime };
}

describe('routeProjectSetup — setup mode', () => {
  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: ORIGINAL_STDIN_TTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: ORIGINAL_STDOUT_TTY, configurable: true });
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('a served runtime with no provider continues in setup mode instead of exiting', async () => {
    const { cwd, workspace, productRuntime } = emptyWorkspace('serve');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      const result = await routeProjectSetup({
        cwd,
        args: baseArgs({ serve: true }),
        startOptions: { productRuntime } as IStartCliOptions,
        terminal: NOOP_TERMINAL,
        providerDefinitions: [],
        workspace,
      });
      expect(result.handled).toBe(false);
      expect(result.setupRequired).toContain('No provider configuration found');
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it('the TUI (no --serve) with no provider still exits, unchanged', async () => {
    const { cwd, workspace, productRuntime } = emptyWorkspace('tui');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const result = await routeProjectSetup({
        cwd,
        args: baseArgs({ serve: false }),
        startOptions: { productRuntime } as IStartCliOptions,
        terminal: NOOP_TERMINAL,
        providerDefinitions: [],
        workspace,
      });
      expect(exit).toHaveBeenCalledWith(1);
      expect(stderr.mock.calls.some((call) => String(call[0]).includes('No provider configuration found'))).toBe(
        true,
      );
      // The mocked exit does not actually stop execution, so the function still returns — its value
      // is not what the real (exited) process would have used; only the exit call matters here.
      void result;
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });

  it('the ACP agent never walks a person through provider setup on its terminal, even when one is attached', async () => {
    // stdout is the protocol channel, so a prompt there would corrupt it; the editor sees the error instead.
    const { cwd, workspace, productRuntime } = emptyWorkspace('acp', { tty: true });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const prompt = vi.fn(() => Promise.resolve(''));
    const select = vi.fn(() => Promise.resolve(0));
    try {
      await routeProjectSetup({
        cwd,
        args: baseArgs({ positional: ['acp'] }),
        startOptions: { productRuntime } as IStartCliOptions,
        terminal: { ...NOOP_TERMINAL, prompt, select },
        providerDefinitions: [],
        workspace,
      });
      expect(prompt).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(vi.mocked(promptInput)).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
      expect(
        stderr.mock.calls.some((call) => String(call[0]).includes('No provider configuration found')),
      ).toBe(true);
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });

  it('print mode with no provider still exits with the print-mode exit code, unchanged', async () => {
    const { cwd, workspace, productRuntime } = emptyWorkspace('print');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await routeProjectSetup({
        cwd,
        args: baseArgs({ printMode: true }),
        startOptions: { productRuntime } as IStartCliOptions,
        terminal: NOOP_TERMINAL,
        providerDefinitions: [],
        workspace,
      });
      expect(exit).toHaveBeenCalledWith(3);
    } finally {
      exit.mockRestore();
      stderr.mockRestore();
    }
  });
});

describe('routeProjectSetup — init', () => {
  let root: string;

  beforeEach(() => {
    vi.mocked(runInitCommand).mockClear();
    vi.mocked(createWorkspaceProjectMutation).mockClear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Runs `init` through the routing. By default the project is trusted and the host supplies no
   * project mutation capability, as the stock entry does.
   */
  async function runInit(
    options: {
      access?: 'trusted' | 'untrusted' | 'revoked';
      hostMutation?: IWorkspaceProjectMutation;
    } = {},
  ) {
    const { access = 'trusted', hostMutation } = options;
    root = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-init-routing-test-')));
    const cwd = join(root, 'project');
    mkdirSync(cwd);
    const productRuntime = createTestProductRuntime('test-product', { HOME: join(root, 'home') });
    const projectAccess =
      access === 'trusted'
        ? await createTrustedWorkspaceProjectAccess(cwd)
        : createRestrictedWorkspaceProjectAccess(access, cwd);
    const workspace = createCliWorkspaceComposition({ productRuntime, cwd, projectAccess });
    const errors: string[] = [];
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      const result = await routeProjectSetup({
        cwd,
        args: baseArgs({ positional: ['init'], yes: true }),
        startOptions: {
          productRuntime,
          ...(hostMutation === undefined ? {} : { projectMutation: hostMutation }),
        } as IStartCliOptions,
        terminal: { ...NOOP_TERMINAL, writeError: (text: string) => void errors.push(text) },
        providerDefinitions: [],
        workspace,
      });
      return { cwd, productRuntime, result, errors, exit: exit.mock.calls };
    } finally {
      exit.mockRestore();
    }
  }

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'init writes the project files in a trusted workspace when the host supplies no mutation capability',
    async () => {
      const { cwd, productRuntime, result, errors, exit } = await runInit();
      expect(errors).toEqual([]);
      expect(exit).toEqual([]);
      expect(result.handled).toBe(true);
      expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true);
      expect(
        readFileSync(join(cwd, productRuntime.layout.projectDirectory, 'settings.json'), 'utf8'),
      ).toContain('permissions');
    },
  );

  it.skipIf(process.platform === 'linux')(
    'init reaches the host refusal, not a missing-permission refusal, when the host cannot prove project writes',
    async () => {
      const { cwd, errors, exit } = await runInit();
      expect(errors.join('\n')).toContain(
        "Project mutation requires stable root-anchored host support: only on Linux can the host prove that a project write stays under the trusted workspace root, so on this platform it refuses every project mutation. Run on Linux, or make the change to the project's files yourself.",
      );
      expect(errors.join('\n')).not.toContain('requires project mutation permission');
      expect(exit).toEqual([[1]]);
      expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
    },
  );

  it.each(['untrusted', 'revoked'] as const)(
    'init in a project that is %s is refused for want of project access and writes nothing',
    async (access) => {
      const { cwd, result, errors, exit } = await runInit({ access });

      expect(result.handled).toBe(true);
      expect(errors).toEqual(['Project initialization requires project access.']);
      expect(exit).toEqual([[1]]);
      expect(readdirSync(cwd)).toEqual([]);
      const handedOn = vi.mocked(runInitCommand).mock.calls[0]?.[1];
      expect(handedOn?.projectMutation).toBeUndefined();
      expect(vi.mocked(createWorkspaceProjectMutation)).not.toHaveBeenCalled();
    },
  );

  it('a mutation capability the host supplies is handed to init as it is, and none is minted', async () => {
    const hostMutation = Object.freeze({
      writeBytes: () => {},
      deleteFile: () => false,
    }) as unknown as IWorkspaceProjectMutation;
    vi.mocked(runInitCommand).mockImplementationOnce(async () => {});

    const { result, errors, exit } = await runInit({ hostMutation });

    expect(result.handled).toBe(true);
    expect(errors).toEqual([]);
    expect(exit).toEqual([]);
    expect(vi.mocked(runInitCommand)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runInitCommand).mock.calls[0]?.[1].projectMutation).toBe(hostMutation);
    expect(vi.mocked(createWorkspaceProjectMutation)).not.toHaveBeenCalled();
  });
});
