import { describe, expect, it } from 'vitest';

import { UnsupportedShellError, resolvePlatformShell } from './platform-shell.js';

describe('resolvePlatformShell', () => {
  it('resolves POSIX and Windows defaults with matching argument families', () => {
    const posix = resolvePlatformShell({ env: {}, platform: 'darwin' });
    expect(posix).toMatchObject({ command: '/bin/sh', kind: 'sh', platform: 'darwin' });
    expect(posix.commandArgs('echo hi')).toEqual(['-c', 'echo hi']);

    const windows = resolvePlatformShell({ env: {}, platform: 'win32' });
    expect(windows).toMatchObject({
      command: 'powershell.exe',
      kind: 'powershell',
      platform: 'win32',
    });
    expect(windows.commandArgs('Write-Output ok')).toEqual([
      '-NoProfile',
      '-Command',
      'Write-Output ok',
    ]);
  });

  it('applies request executable > ROBOTA_SHELL > SHELL/platform-default precedence', () => {
    expect(
      resolvePlatformShell({
        executable: '/requested/bash',
        env: { ROBOTA_SHELL: '/env/sh', SHELL: '/login/zsh' },
        platform: 'linux',
      }).command,
    ).toBe('/requested/bash');
    expect(
      resolvePlatformShell({
        env: { ROBOTA_SHELL: '/env/sh', SHELL: '/login/bash' },
        platform: 'linux',
      }).command,
    ).toBe('/env/sh');
    expect(resolvePlatformShell({ env: { SHELL: '/login/bash' }, platform: 'linux' }).command).toBe(
      '/login/bash',
    );
  });

  it.each([
    {
      executable: 'C:\\Tools\\SH.EXE',
      platform: 'win32' as const,
      kind: 'sh',
      args: ['-c', 'sentinel'],
    },
    {
      executable: 'C:\\Tools\\BaSh.ExE',
      platform: 'win32' as const,
      kind: 'bash',
      args: ['-c', 'sentinel'],
    },
    {
      executable: '/opt/Microsoft/PowerShell/PWSH',
      platform: 'linux' as const,
      kind: 'powershell',
      args: ['-NoProfile', '-Command', 'sentinel'],
    },
    {
      executable: '/windows/System32/CMD.exe',
      platform: 'darwin' as const,
      kind: 'cmd',
      args: ['/d', '/s', '/c', 'sentinel'],
    },
  ])(
    'classifies $executable independently of host $platform',
    ({ executable, platform, kind, args }) => {
      const shell = resolvePlatformShell({ executable, env: {}, platform });
      expect(shell).toMatchObject({ command: executable, kind, platform });
      expect(shell.commandArgs('sentinel')).toEqual(args);
    },
  );

  it('treats a blank request executable as absent', () => {
    const shell = resolvePlatformShell({
      executable: '   ',
      env: { ROBOTA_SHELL: '/bin/bash' },
      platform: 'linux',
    });
    expect(shell).toMatchObject({ command: '/bin/bash', kind: 'bash' });
  });

  it('keeps an ordinary POSIX SHELL as the host-declared POSIX family', () => {
    const shell = resolvePlatformShell({ env: { SHELL: '/bin/zsh' }, platform: 'darwin' });
    expect(shell).toMatchObject({ command: '/bin/zsh', kind: 'sh', platform: 'darwin' });
  });

  it.each([
    { executable: '/opt/fish', source: 'request' },
    { executable: 'C:\\Tools\\nu.exe', source: 'request' },
  ])('fails closed for unknown explicit $source executable $executable', ({ executable }) => {
    expect(() => resolvePlatformShell({ executable, env: {}, platform: 'linux' })).toThrow(
      UnsupportedShellError,
    );
    try {
      resolvePlatformShell({ executable, env: {}, platform: 'linux' });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_SHELL',
        executable,
        category: 'user',
        recoverable: false,
      });
    }
  });

  it('fails closed for an unknown ROBOTA_SHELL override', () => {
    expect(() =>
      resolvePlatformShell({ env: { ROBOTA_SHELL: '/bin/fish' }, platform: 'linux' }),
    ).toThrow(UnsupportedShellError);
  });

  it('retains host-specific syntax guidance', () => {
    expect(resolvePlatformShell({ env: {}, platform: 'darwin' }).syntaxHint).toMatch(/macOS|BSD/);
    expect(resolvePlatformShell({ env: {}, platform: 'linux' }).syntaxHint).toMatch(/Linux|GNU/);
    expect(resolvePlatformShell({ env: {}, platform: 'win32' }).syntaxHint).toMatch(/PowerShell/);
  });
});
