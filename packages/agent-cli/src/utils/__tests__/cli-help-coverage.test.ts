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

describe('robota --help', () => {
  it('lists every option the parser accepts, except those not meant for people', () => {
    const help = printHelp();
    const missing = CLI_OPTION_NAMES.filter(
      (name) => !NOT_IN_GLOBAL_HELP.has(name) && !help.includes(`--${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('lists every effort level --effort accepts', () => {
    const effortLine = printHelp()
      .split('\n')
      .find((line) => line.trimStart().startsWith('--effort'));
    for (const level of ['auto', ...MODEL_EFFORT_VALUES]) {
      expect(effortLine).toContain(level);
    }
  });

  it('describes --bare as what it does: skipping instruction files and plugins', () => {
    const bareLine = printHelp()
      .split('\n')
      .find((line) => line.trimStart().startsWith('--bare'));
    expect(bareLine).toContain('instruction files');
    expect(bareLine).not.toContain('raw text');
  });
});

describe('robota <subcommand> --help', () => {
  it('prints only that subcommand’s entries', () => {
    const trust = subcommandHelpFor(['trust', '--help']);
    expect(trust).toContain('robota trust [status|grant|revoke]');
    expect(trust).not.toContain('robota daemon');

    const session = subcommandHelpFor(['session', 'start', '-h']);
    expect(session).toContain('robota session start --background');
    expect(session).toContain('robota session list');
    expect(session).not.toContain('robota trust');
  });

  it('treats the doctor aliases as doctor and lists mcp serve’s transport options with mcp', () => {
    expect(subcommandHelpFor(['checkup', '--help'])).toContain('robota doctor --repair');
    expect(subcommandHelpFor(['mcp', 'serve', '--help'])).toContain('--http-token-file');
  });

  it('is undefined without --help, or for something that is not a subcommand', () => {
    expect(subcommandHelpFor(['trust', 'status'])).toBeUndefined();
    expect(subcommandHelpFor(['-p', 'hello', '--help'])).toBeUndefined();
  });

  describe('through the pre-parse router', () => {
    const exitCode = process.exitCode;
    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = exitCode;
    });

    it.each([['trust'], ['doctor'], ['session'], ['init'], ['open'], ['mcp', 'serve']])(
      'robota %s --help prints help and exits 0 instead of running the command',
      async (...subcommand: string[]) => {
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        process.exitCode = undefined;

        const handled = await runPreparsedCliCommand(
          { providerDefinitions: [] },
          ['node', 'robota', ...subcommand, '--help'],
          '/nonexistent-robota-help-cwd',
        );

        expect(handled).toBe(true);
        expect(process.exitCode).toBe(0);
        expect(stderr).not.toHaveBeenCalled();
        expect(stdout.mock.calls.flat().join('')).toContain(`robota ${subcommand[0]}`);
      },
    );
  });
});
