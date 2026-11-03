import { describe, expect, it } from 'vitest';
import { refusedRemoteDebuggingSwitch } from '../launch-guard.js';

const chromiumSees =
  (...names: string[]) =>
  (name: string): boolean =>
    names.includes(name);

/**
 * No fuse turns Chromium's remote debugging off, and through it a program of the same OS user could run code in the
 * renderer and reach the main-process bridge, so the packaged app refuses to start when asked to open it.
 */
describe('refusedRemoteDebuggingSwitch', () => {
  const packaged = (argv: string[], hasSwitch = chromiumSees()) =>
    refusedRemoteDebuggingSwitch({ isPackaged: true, argv: ['/app/robota-desktop', ...argv], hasSwitch });

  it('refuses a packaged launch asked for a remote debugging port, in either value form', () => {
    expect(packaged(['--remote-debugging-port=9222'])).toBe('remote-debugging-port');
    expect(packaged(['--remote-debugging-port', '9222'])).toBe('remote-debugging-port');
    expect(packaged(['--remote-debugging-port=0'])).toBe('remote-debugging-port');
  });

  it('refuses a packaged launch asked for a remote debugging pipe', () => {
    expect(packaged(['--remote-debugging-pipe'])).toBe('remote-debugging-pipe');
    expect(packaged(['--remote-debugging-pipe=cbor'])).toBe('remote-debugging-pipe');
  });

  it('reads every switch spelling Chromium accepts: a single dash, a Windows slash, any case', () => {
    expect(packaged(['-remote-debugging-port=9222'])).toBe('remote-debugging-port');
    expect(packaged(['/Remote-Debugging-Port=9222'])).toBe('remote-debugging-port');
    expect(packaged(['--REMOTE-DEBUGGING-PIPE'])).toBe('remote-debugging-pipe');
  });

  it("refuses a switch Chromium's own parse reports even when argv does not show it", () => {
    expect(packaged([], chromiumSees('remote-debugging-pipe'))).toBe('remote-debugging-pipe');
    expect(packaged(['--enable-logging'], chromiumSees('remote-debugging-port'))).toBe('remote-debugging-port');
  });

  it('lets an ordinary packaged launch through', () => {
    expect(packaged([])).toBeUndefined();
    expect(packaged(['--enable-logging', '/Users/me/project', '--remote-debugging-portal=1'])).toBeUndefined();
  });

  it('leaves a development launch alone (Playwright drives the unpackaged app over remote debugging)', () => {
    expect(
      refusedRemoteDebuggingSwitch({
        isPackaged: false,
        argv: ['/node_modules/electron/dist/Electron', '--inspect=0', '--remote-debugging-port=0', 'dist/electron/main.js'],
        hasSwitch: chromiumSees('remote-debugging-port', 'remote-debugging-pipe'),
      }),
    ).toBeUndefined();
  });
});
