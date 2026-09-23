import { describe, expect, it } from 'vitest';

import { scrubbedGitEnv } from '../default-plugin-command-adapter.js';

/**
 * SEC-017 (issue #2019) — argv stops the SHELL; the environment is the other door.
 *
 * `GIT_SSH_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_PROXY_COMMAND` and `GIT_ASKPASS` each name a PROGRAM
 * git executes. An inherited one turns `git clone <url>` into "run whatever that variable says" —
 * the same arbitrary execution the string-shell port allowed, reached without any shell at all. So
 * the argv fix is only half of it, and this asserts the other half.
 */
describe('SEC-017 — a git subprocess inherits only an allowlisted environment', () => {
  // Each of these names a program git will run.
  const EXECUTABLE_VARIABLES = [
    'GIT_SSH_COMMAND',
    'GIT_SSH',
    'GIT_EXTERNAL_DIFF',
    'GIT_PROXY_COMMAND',
    'GIT_ASKPASS',
    'GIT_EDITOR',
    'GIT_PAGER',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_GLOBAL',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_DIR',
    'GIT_WORK_TREE',
  ];

  it.each(EXECUTABLE_VARIABLES)('drops %s', (name) => {
    const env = scrubbedGitEnv({ PATH: '/usr/bin', [name]: 'touch /tmp/pwned' });
    expect(env[name]).toBeUndefined();
  });

  it('keeps what git needs to run at all', () => {
    const env = scrubbedGitEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      HTTPS_PROXY: 'http://proxy:8080',
      GIT_SSH_COMMAND: 'touch /tmp/pwned',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    // A proxy variable names a SERVER, not a program to run, and dropping it breaks clone behind a
    // corporate proxy — a real configuration rather than an attack surface.
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
    expect(env.GIT_SSH_COMMAND).toBeUndefined();
  });

  it('is an allowlist, so a variable nobody thought of is dropped rather than passed', () => {
    // The set of git-honoured variables is git's to grow. A denylist written today is wrong the next
    // time it does; this asserts the direction of the default, not a list of known-bad names.
    const env = scrubbedGitEnv({
      PATH: '/usr/bin',
      SOME_FUTURE_GIT_HOOK_VARIABLE: 'touch /tmp/pwned',
      LD_PRELOAD: '/tmp/evil.so',
    });
    expect(Object.keys(env)).toEqual(['PATH']);
  });

  it('does not invent values that were not in the source environment', () => {
    const env = scrubbedGitEnv({});
    expect(env).toEqual({});
  });
});
