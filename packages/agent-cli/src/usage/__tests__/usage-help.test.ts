/**
 * The help of `usage` and `usage export` is answered by the router before it composes a session
 * store, so it needs the help alone and never a saved session. The same text is what each command
 * prints when it is run with the flag, and any other invocation is no request for help.
 */
import { describe, expect, it } from 'vitest';

import { executeUsageCommand, usageHelp } from '../usage-command.js';
import { executeUsageExportCommand, usageHelpFor } from '../usage-export-command.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

const CLI = 'test-product';

describe('the help of usage, answered with no store', () => {
  it.each([[['--help']], [['-h']]])('is the usage help for %j', (argv) => {
    const help = usageHelpFor(argv, CLI);

    expect(help).toBe(usageHelp(CLI));
    expect(help).toContain(`Usage: ${CLI} usage [options]`);
  });

  it.each([[['export', '--help']], [['export', '-h']]])('is the export help for %j', (argv) => {
    expect(usageHelpFor(argv, CLI)).toContain('Usage: usage export');
  });

  it.each([
    [[]],
    [['--format', 'json']],
    [['--help', '--format', 'json']],
    [['export']],
    [['export', '--endpoint', 'http://127.0.0.1:4318']],
    [['export', '--help', 'extra']],
  ])('is none for %j', (argv) => {
    expect(usageHelpFor(argv, CLI)).toBeUndefined();
  });

  it('is what each command prints for the flag, from the same text', async () => {
    const stores = {} as unknown as IInteractiveSessionStore;

    expect(executeUsageCommand(['--help'], { userSessionStore: stores }, CLI).stdout).toBe(
      usageHelpFor(['--help'], CLI),
    );
    expect(
      (await executeUsageExportCommand(['--help'], { serviceName: 'x', userSessionStore: stores }))
        .stdout,
    ).toBe(usageHelpFor(['export', '--help'], CLI));
  });
});
