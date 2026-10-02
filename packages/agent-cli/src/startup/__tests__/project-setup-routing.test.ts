import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * #3282 §3 — a served runtime (`--serve`, and a daemon's spawned child, which is also `--serve`) with
 * no usable provider configuration starts in setup mode instead of exiting. The TUI and print mode are
 * unchanged: they still exit with the same message.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeProjectSetup } from '../project-setup-routing.js';
import { createCliWorkspaceComposition } from '../workspace-project-composition.js';

import type { IStartCliOptions } from '../cli-options-types.js';
import type { IParsedCliArgs } from '../../utils/cli-args.js';
import type { ITerminalOutput, ISpinner } from '@robota-sdk/agent-core';

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
function emptyWorkspace(name: string) {
  const project = join(TMP_BASE, `${name}-project`);
  const home = join(TMP_BASE, `${name}-home`);
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  const productRuntime = createTestProductRuntime('test-product', { HOME: home });
  const workspace = createCliWorkspaceComposition({productRuntime,  cwd: project, userHome: home });
  return { cwd: project, workspace, productRuntime };
}

describe('routeProjectSetup — #3282 §3 setup mode', () => {
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
