/**
 * Which invocations are project or provider setup and nothing else, which in secure conversations
 * run without a conversation store. An invocation that goes on to run a session — a print run, a
 * prompt, the terminal, the protocol servers — is none of them: it needs a store, and so a key
 * holder, whatever else it carries.
 */
import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../../utils/cli-args.js';
import { isProjectSetupInvocation } from '../project-setup-routing.js';

describe('isProjectSetupInvocation', () => {
  it.each([
    ['init', ['init']],
    ['init --yes', ['init', '--yes']],
    ['--configure', ['--configure']],
    ['--configure-provider', ['--configure-provider', 'work', '--type', 'openai']],
    [
      '--configure-provider --set-current',
      ['--configure-provider', 'work', '--type', 'openai', '--set-current'],
    ],
    [
      '--configure-provider --settings-scope user',
      ['--configure-provider', 'work', '--type', 'openai', '--settings-scope', 'user'],
    ],
  ])('is true for %s', (_name, argv) => {
    expect(isProjectSetupInvocation(parseCliArgs(argv))).toBe(true);
  });

  it.each([
    ['the terminal', []],
    ['a print run', ['-p', 'hello']],
    ['a prompt', ['hello']],
    ['--serve', ['--serve']],
    ['acp', ['acp']],
    ['mcp serve', ['mcp', 'serve']],
    ['session list', ['session', 'list']],
    ['usage', ['usage']],
    ['--provider --set-current', ['--provider', 'work', '--set-current']],
    [
      '--configure-provider with a print run',
      ['--configure-provider', 'work', '--type', 'openai', '-p', 'hello'],
    ],
    [
      '--configure-provider with a prompt',
      ['--configure-provider', 'work', '--type', 'openai', 'hello'],
    ],
  ])('is false for %s', (_name, argv) => {
    expect(isProjectSetupInvocation(parseCliArgs(argv))).toBe(false);
  });
});
