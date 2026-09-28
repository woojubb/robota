import { describe, expect, it } from 'vitest';

import { buildBundledRuntimeChildEnv } from '../child-env.mjs';

/**
 * GUI-003 / #3356 — the bundled-runtime e2e failed on Windows only: the packaged runtime's
 * `os.homedir()` reads `USERPROFILE` there, never `HOME`, so a sandbox env that set only `HOME` never
 * isolated `~/.robota` on Windows. The runtime fell through to the real runner profile, found no
 * `settings.json` ("No provider configuration found.") and a rendezvous directory it did not control.
 */
describe('buildBundledRuntimeChildEnv (GUI-003, #3356 Windows sandbox)', () => {
  it('sets USERPROFILE alongside HOME, so os.homedir() is sandboxed on win32 too', () => {
    const env = buildBundledRuntimeChildEnv({
      path: '/usr/bin',
      home: '/tmp/gui003-home',
      token: 'tok',
      port: 1234,
    });
    expect(env.HOME).toBe('/tmp/gui003-home');
    expect(env.USERPROFILE).toBe('/tmp/gui003-home');
  });

  it('carries SystemRoot through when the host has one', () => {
    const env = buildBundledRuntimeChildEnv({
      path: '/usr/bin',
      home: '/tmp/h',
      token: 't',
      port: 1,
      systemRoot: 'C:\\Windows',
    });
    expect(env.SystemRoot).toBe('C:\\Windows');
  });

  it('omits SystemRoot when the host has none, rather than publishing it as undefined', () => {
    const env = buildBundledRuntimeChildEnv({ path: '/usr/bin', home: '/tmp/h', token: 't', port: 1 });
    expect('SystemRoot' in env).toBe(false);
  });

  it('is a curated allowlist, not the ambient environment — only what the packaged runtime needs', () => {
    const env = buildBundledRuntimeChildEnv({ path: '/usr/bin', home: '/tmp/h', token: 't', port: 1 });
    expect(Object.keys(env).sort()).toEqual([
      'HOME',
      'PATH',
      'ROBOTA_WS_PORT',
      'ROBOTA_WS_TOKEN',
      'USERPROFILE',
    ]);
  });

  it('stringifies the port, since env values must be strings', () => {
    const env = buildBundledRuntimeChildEnv({ path: '/usr/bin', home: '/tmp/h', token: 't', port: 4321 });
    expect(env.ROBOTA_WS_PORT).toBe('4321');
  });
});
