import { describe, it, expect } from 'vitest';

import {
  appendOutputTail,
  buildDaemonStartSpawn,
  describeDaemonStartFailure,
  OUTPUT_TAIL_LIMIT,
  parseDaemonStartOutput,
  resolveSidecarCommand,
} from '../sidecar.js';

/** The Electron-free shell logic: which command, how the daemon is started, and what its answer may be. */

/** GUI-003 TC-03 — the bundled-runtime command resolution (packaged vs dev). */
describe('resolveSidecarCommand (GUI-003)', () => {
  it('packaged: resolves the bundled binary under resourcesPath (posix)', () => {
    expect(
      resolveSidecarCommand({
        isPackaged: true,
        resourcesPath: '/Applications/Robota.app/Contents/Resources',
        platform: 'darwin',
        env: { ROBOTA_GUI_SIDECAR_CMD: '/ignored/in/prod' },
      }),
    ).toBe('/Applications/Robota.app/Contents/Resources/robota');
  });

  it('packaged on win32: appends the .exe suffix', () => {
    expect(
      resolveSidecarCommand({
        isPackaged: true,
        resourcesPath: 'C:\\Program Files\\Robota\\resources',
        platform: 'win32',
      }),
    ).toContain('robota.exe');
  });

  it('dev: honors $ROBOTA_GUI_SIDECAR_CMD (the e2e/scripted double)', () => {
    expect(
      resolveSidecarCommand({
        isPackaged: false,
        resourcesPath: '/unused',
        platform: 'linux',
        env: { ROBOTA_GUI_SIDECAR_CMD: '/repo/e2e/scripted-sidecar.mjs' },
      }),
    ).toBe('/repo/e2e/scripted-sidecar.mjs');
  });

  it('dev without override: falls back to PATH `robota`', () => {
    expect(
      resolveSidecarCommand({
        isPackaged: false,
        resourcesPath: '/unused',
        platform: 'linux',
        env: {},
      }),
    ).toBe('robota');
  });
});

describe('buildDaemonStartSpawn (#3189)', () => {
  it('asks the CLI to start or reuse the daemon, with the base environment and no secret of its own', () => {
    const invocation = buildDaemonStartSpawn('/opt/robota', { PATH: '/usr/bin', UNSET: undefined });
    expect(invocation.command).toBe('/opt/robota');
    expect(invocation.args).toEqual(['daemon', 'start', '--json']);
    expect(invocation.env).toEqual({ PATH: '/usr/bin' });
    expect(invocation.env).not.toHaveProperty('ROBOTA_WS_TOKEN');
  });
});

describe('parseDaemonStartOutput (#3189)', () => {
  const url = 'ws://127.0.0.1:51234?token=0123abcd';

  it('reads the one JSON line into the id, URL and port', () => {
    expect(parseDaemonStartOutput(`${JSON.stringify({ id: 'd-1', url })}\n`)).toEqual({
      id: 'd-1',
      url,
      port: 51234,
    });
  });

  it('accepts a root path before the query', () => {
    expect(
      parseDaemonStartOutput(JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:9/?token=t' }))?.port,
    ).toBe(9);
  });

  it.each([
    ['empty output', ''],
    ['not JSON', 'daemon started'],
    ['two lines', `${JSON.stringify({ id: 'd', url })}\n${JSON.stringify({ id: 'd', url })}`],
    ['missing id', JSON.stringify({ url })],
    ['empty id', JSON.stringify({ id: ' ', url })],
    ['a JSON array', JSON.stringify([url])],
    ['a non-loopback host', JSON.stringify({ id: 'd', url: 'ws://10.0.0.1:51234?token=t' })],
    ['localhost by name', JSON.stringify({ id: 'd', url: 'ws://localhost:51234?token=t' })],
    ['a lookalike host', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1.evil.test:51234?token=t' })],
    ['credentials in the URL', JSON.stringify({ id: 'd', url: 'ws://u@127.0.0.1:51234?token=t' })],
    ['wss', JSON.stringify({ id: 'd', url: 'wss://127.0.0.1:51234?token=t' })],
    ['no port', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1?token=t' })],
    ['port 0', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:0?token=t' })],
    ['port above 65535', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:65536?token=t' })],
    ['an empty token', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:51234?token=' })],
    ['no token', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:51234' })],
    ['a path', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:51234/x?token=t' })],
    ['extra query', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:51234?token=t&x=1' })],
    ['a fragment', JSON.stringify({ id: 'd', url: 'ws://127.0.0.1:51234?token=t#x' })],
  ])('refuses %s', (_label, stdout) => {
    expect(parseDaemonStartOutput(stdout)).toBeUndefined();
  });
});

describe('describeDaemonStartFailure (#3189)', () => {
  it('shows what the CLI said, which names the fix', () => {
    expect(
      describeDaemonStartFailure({
        exitCode: 1,
        stderr: 'Workspace is not trusted. Run: robota trust --yes\n',
        stdout: '',
      }),
    ).toBe('Workspace is not trusted. Run: robota trust --yes');
  });

  it('describes an unexpected answer on a successful exit', () => {
    expect(describeDaemonStartFailure({ exitCode: 0, stderr: '', stdout: 'hello' })).toContain(
      'unexpected result:\nhello',
    );
  });

  it('names the exit code when the CLI said nothing', () => {
    expect(describeDaemonStartFailure({ exitCode: 3, stderr: '', stdout: '' })).toContain('exit 3');
  });
});

describe('#3186 — why the daemon could not start', () => {
  it('keeps only the tail of the CLI error output, so the fatal screen can say why', () => {
    let tail = '';
    tail = appendOutputTail(tail, 'x'.repeat(OUTPUT_TAIL_LIMIT));
    tail = appendOutputTail(tail, 'Workspace trust is required.\nGrant access with: robota trust --yes\n');
    expect(tail.length).toBe(OUTPUT_TAIL_LIMIT);
    expect(tail.endsWith('Grant access with: robota trust --yes\n')).toBe(true);
  });
});
