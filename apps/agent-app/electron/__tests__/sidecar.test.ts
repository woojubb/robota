import { describe, it, expect } from 'vitest';

import {
  appendOutputTail,
  buildContentSecurityPolicy,
  buildDaemonStartSpawn,
  createDaemonAttachment,
  describeDaemonStartFailure,
  OUTPUT_TAIL_LIMIT,
  parseDaemonStartOutput,
  resolveSidecarCommand,
  type TDaemonStart,
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

/** #3189 — a daemon that stops while the window is open is reattached by starting again. */
describe('createDaemonAttachment (#3189)', () => {
  const at = (port: number): TDaemonStart => ({
    ok: true,
    endpoint: { id: 'd', url: `ws://127.0.0.1:${port}?token=t`, port },
  });

  it('has no answer and no port before the first start', () => {
    const attachment = createDaemonAttachment(async () => at(1));
    expect(attachment.current()).toBeNull();
    expect(attachment.port()).toBeUndefined();
  });

  it('answers with the latest start, whose port may differ from the one before', async () => {
    const answers = [at(4001), at(4002)];
    const attachment = createDaemonAttachment(async () => answers.shift() ?? at(0));
    await attachment.start();
    expect(attachment.port()).toBe(4001);
    await attachment.start();
    expect(attachment.port()).toBe(4002);
    await expect(attachment.current()).resolves.toEqual(at(4002));
  });

  it('a failed restart leaves no port to reach, and carries the reason', async () => {
    const answers: TDaemonStart[] = [at(4001), { ok: false, detail: 'Run: robota trust --yes' }];
    const attachment = createDaemonAttachment(async () => answers.shift() ?? at(0));
    await attachment.start();
    await attachment.start();
    expect(attachment.port()).toBeUndefined();
    await expect(attachment.current()).resolves.toEqual({ ok: false, detail: 'Run: robota trust --yes' });
  });

  it('a start asked for while one runs joins it instead of running the CLI again', async () => {
    let runs = 0;
    let finish: (value: TDaemonStart) => void = () => {};
    const attachment = createDaemonAttachment(() => {
      runs += 1;
      return new Promise<TDaemonStart>((resolve) => {
        finish = resolve;
      });
    });
    const first = attachment.start();
    const second = attachment.start();
    expect(second).toBe(first);
    expect(runs).toBe(1);
    finish(at(4003));
    await first;
    void attachment.start();
    expect(runs).toBe(2);
  });
});

describe('buildContentSecurityPolicy (#3189)', () => {
  it("lets the page reach only the daemon's loopback port", () => {
    expect(buildContentSecurityPolicy(4321)).toContain('connect-src ws://127.0.0.1:4321;');
  });

  it('lets the page reach nothing when there is no daemon', () => {
    expect(buildContentSecurityPolicy(undefined)).toContain("connect-src 'none';");
  });
});
