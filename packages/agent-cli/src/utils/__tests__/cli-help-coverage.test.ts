import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MODEL_EFFORT_VALUES } from '@robota-sdk/agent-core';

import { CLI_OPTION_NAMES } from '../cli-args.js';
import { printHelp, subcommandHelpFor } from '../cli-help.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';

/**
 * Options the parser accepts that are not for people: set by the CLI for its own child processes,
 * retired and parsed only to be refused, or a subcommand's own option listed with that subcommand.
 */
const NOT_IN_GLOBAL_HELP = new Set([
  'moved-from',
  'supervised-session-id',
  'supervised-external-event-grants',
  'daemon',
  'external-event-allow',
  // `the product session list --format` is listed with that command; `--summary` and `--source` belong
  // to an internal command.
  'format',
  'summary',
  'source',
  // Listed as the `--memory / --no-memory` style pairs.
  'no-memory',
  'no-screen-reader',
  'no-reduced-motion',
  // `-p` and `-h` are listed by their short form.
  'p',
  'help',
]);

describe('test-product --help', () => {
  it('lists every option the parser accepts, except those not meant for people', () => {
    const help = printHelp(createTestProductRuntime());
    const missing = CLI_OPTION_NAMES.filter(
      (name) => !NOT_IN_GLOBAL_HELP.has(name) && !new RegExp(`--${name}(?![\\w-])`).test(help),
    );
    expect(missing).toEqual([]);
  });

  it('lists every effort level --effort accepts', () => {
    const effortLine = printHelp(createTestProductRuntime())
      .split('\n')
      .find((line) => line.trimStart().startsWith('--effort'));
    for (const level of ['auto', ...MODEL_EFFORT_VALUES]) {
      expect(effortLine).toContain(level);
    }
  });

  it('describes --bare as what it does: skipping instruction files and plugins', () => {
    const bareLine = printHelp(createTestProductRuntime())
      .split('\n')
      .find((line) => line.trimStart().startsWith('--bare'));
    expect(bareLine).toContain('instruction files');
    expect(bareLine).not.toContain('raw text');
  });
});

describe('test-product <subcommand> --help', () => {
  it('prints only that subcommand’s entries', () => {
    const trust = subcommandHelpFor(['trust', '--help'], createTestProductRuntime());
    expect(trust).toContain('test-product trust [status|grant|revoke]');
    expect(trust).not.toContain('test-product daemon');

    const session = subcommandHelpFor(['session', 'start', '-h'], createTestProductRuntime());
    expect(session).toContain('test-product session start --background');
    expect(session).toContain('test-product session list');
    expect(session).not.toContain('test-product trust');
  });

  it('treats the doctor aliases as doctor and lists mcp serve’s transport options with mcp', () => {
    expect(subcommandHelpFor(['checkup', '--help'], createTestProductRuntime())).toContain('test-product doctor --repair');
    expect(subcommandHelpFor(['mcp', 'serve', '--help'], createTestProductRuntime())).toContain('--http-token-file');
  });

  it('leaves --help to a command that prints fuller help of its own', () => {
    for (const args of [
      ['usage', '--help'],
      ['usage', 'export', '--help'],
      ['session', 'list', '--help'],
      ['session', 'view', '-h'],
      ['session', 'attach', '--help'],
    ]) {
      expect(subcommandHelpFor(args, createTestProductRuntime())).toBeUndefined();
    }
  });

  it('is undefined without --help, or for something that is not a subcommand', () => {
    expect(subcommandHelpFor(['trust', 'status'], createTestProductRuntime())).toBeUndefined();
    expect(subcommandHelpFor(['-p', 'hello', '--help'], createTestProductRuntime())).toBeUndefined();
  });

  describe('through the pre-parse router', () => {
    const exitCode = process.exitCode;
    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = exitCode;
    });

    it.each([
      ['trust'],
      ['doctor'],
      ['session'],
      ['session', 'start'],
      ['init'],
      ['open'],
      ['mcp', 'serve'],
      ['daemon'],
      ['eval'],
    ])(
      'test-product %s --help prints help and exits 0 instead of running the command',
      async (...subcommand: string[]) => {
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        process.exitCode = undefined;

        const handled = await runPreparsedCliCommand(
          {productRuntime: createTestProductRuntime(),  providerDefinitions: [] },
          ['node', 'test-product', ...subcommand, '--help'],
          '/nonexistent-test-product-help-cwd',
        );

        expect(handled).toBe(true);
        expect(process.exitCode).toBe(0);
        expect(stderr).not.toHaveBeenCalled();
        expect(stdout.mock.calls.flat().join('')).toContain(`test-product ${subcommand[0]}`);
      },
    );
  });
});

describe('the help router hands --help to commands with their own help', () => {
  const exitCode = process.exitCode;
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = exitCode;
  });

  it.each([
    [['usage'], '--period'],
    [['usage', 'export'], '--signal'],
    [['session', 'view'], '--state'],
    [['session', 'attach'], '--observe'],
  ])('test-product %j --help prints the command’s own help', async (subcommand, expected) => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;

    await runPreparsedCliCommand(
      {productRuntime: createTestProductRuntime(),  providerDefinitions: [] },
      ['node', 'test-product', ...subcommand, '--help'],
      '/nonexistent-test-product-help-cwd',
    );

    expect(stdout.mock.calls.flat().join('')).toContain(expected);
  });

  it('lists every option daemon start and eval accept in their entries', () => {
    expect(subcommandHelpFor(['daemon', '--help'], createTestProductRuntime())).toContain('--restricted-workspace');
    expect(subcommandHelpFor(['eval', '--help'], createTestProductRuntime())).toContain('--threshold');
  });
});
