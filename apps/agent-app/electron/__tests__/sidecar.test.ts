import { describe, it, expect, vi } from 'vitest';

import {
  buildSidecarSpawn,
  endpointUrl,
  mintToken,
  SidecarSupervisor,
  type ISupervisedChild,
  type TSidecarState,
} from '../sidecar.js';

/** GUI-002 TC-04 — the Electron-free sidecar logic (spawn args, endpoint, supervision). */

const endpoint = { port: 51234, token: 'nonce-abc' };

describe('endpoint + spawn args (GUI-002)', () => {
  it('mints a 256-bit hex token', () => {
    const t = mintToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(mintToken()).not.toBe(t); // fresh each call
  });

  it('endpointUrl carries the token as a query param (browser WebSocket canʼt set headers)', () => {
    expect(endpointUrl(endpoint)).toBe('ws://127.0.0.1:51234?token=nonce-abc');
  });

  it('puts the token+port in the child ENV, never on argv (argv is world-readable via ps)', () => {
    const spawn = buildSidecarSpawn(endpoint, {
      baseEnv: { PATH: '/usr/bin' },
      extraArgs: ['--foo'],
    });
    expect(spawn.command).toBe('robota');
    expect(spawn.env['ROBOTA_WS_TOKEN']).toBe('nonce-abc');
    expect(spawn.env['ROBOTA_WS_PORT']).toBe('51234');
    expect(spawn.env['PATH']).toBe('/usr/bin'); // base env preserved
    expect(spawn.args).toEqual(['--foo']);
    expect(spawn.args.join(' ')).not.toContain('nonce-abc'); // token NOT on argv
  });

  it('honors a command override (later: the bundled binary)', () => {
    expect(buildSidecarSpawn(endpoint, { command: '/opt/robota' }).command).toBe('/opt/robota');
  });
});

/** A controllable stub child for the supervisor. */
function stubChild(): ISupervisedChild & {
  fireExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  kills: string[];
} {
  let exitCb: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const kills: string[] = [];
  return {
    on: (_e, cb) => {
      exitCb = cb;
    },
    kill: (sig = 'SIGTERM') => {
      kills.push(sig);
      return true;
    },
    fireExit: (code, signal) => exitCb?.(code, signal),
    kills,
  };
}

describe('SidecarSupervisor (GUI-002 TC-04)', () => {
  it('an unexpected child exit surfaces a non-hanging FATAL state', () => {
    const states: TSidecarState[] = [];
    const child = stubChild();
    new SidecarSupervisor(child, (s) => states.push(s));
    child.fireExit(1, null);
    expect(states).toEqual(['fatal']);
  });

  it('markReady transitions to ready', () => {
    const states: TSidecarState[] = [];
    const sup = new SidecarSupervisor(stubChild(), (s) => states.push(s));
    sup.markReady();
    expect(states).toEqual(['ready']);
    expect(sup.currentState).toBe('ready');
  });

  it('shutdown sends SIGTERM then a SIGKILL backstop, and a subsequent exit is NOT fatal', () => {
    const states: TSidecarState[] = [];
    const child = stubChild();
    const timers: Array<() => void> = [];
    const sup = new SidecarSupervisor(
      child,
      (s) => states.push(s),
      3000,
      (fn) => timers.push(fn),
    );
    sup.shutdown();
    expect(child.kills).toEqual(['SIGTERM']);
    timers.forEach((fn) => fn()); // fire the backstop timer
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
    child.fireExit(0, 'SIGTERM'); // expected exit during shutdown
    expect(states).not.toContain('fatal');
  });

  it('is idempotent on repeated shutdown', () => {
    const child = stubChild();
    const sup = new SidecarSupervisor(child, vi.fn(), 3000, vi.fn());
    sup.shutdown();
    sup.shutdown();
    expect(child.kills).toEqual(['SIGTERM']); // second shutdown is a no-op
  });
});
