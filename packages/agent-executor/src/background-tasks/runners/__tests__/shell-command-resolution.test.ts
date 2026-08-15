import { describe, expect, it } from 'vitest';

import { resolveBackgroundTaskShellCommand } from '../shell-command-resolution.js';

describe('resolveBackgroundTaskShellCommand', () => {
  it.each([
    {
      name: 'POSIX default',
      request: { command: 'sentinel' },
      options: { env: {}, platform: 'linux' as const },
      executable: '/bin/sh',
      args: ['-c', 'sentinel'],
    },
    {
      name: 'Windows default PowerShell',
      request: { command: 'sentinel' },
      options: { env: {}, platform: 'win32' as const },
      executable: 'powershell.exe',
      args: ['-NoProfile', '-Command', 'sentinel'],
    },
    {
      name: 'Windows explicit bash',
      request: { command: 'sentinel', shell: 'C:\\Git\\bin\\bash.exe' },
      options: { env: { ROBOTA_SHELL: 'powershell.exe' }, platform: 'win32' as const },
      executable: 'C:\\Git\\bin\\bash.exe',
      args: ['-c', 'sentinel'],
    },
    {
      name: 'POSIX explicit pwsh',
      request: { command: 'sentinel', shell: '/usr/local/bin/pwsh' },
      options: { env: { SHELL: '/bin/bash' }, platform: 'linux' as const },
      executable: '/usr/local/bin/pwsh',
      args: ['-NoProfile', '-Command', 'sentinel'],
    },
    {
      name: 'mixed-case cmd path',
      request: { command: 'sentinel', shell: 'C:\\Windows\\System32\\CMD.EXE' },
      options: { env: {}, platform: 'darwin' as const },
      executable: 'C:\\Windows\\System32\\CMD.EXE',
      args: ['/d', '/s', '/c', 'sentinel'],
    },
  ])(
    'keeps executable and argument family together: $name',
    ({ request, options, executable, args }) => {
      expect(resolveBackgroundTaskShellCommand(request, options)).toEqual({ executable, args });
    },
  );

  it('treats a blank request shell as absent', () => {
    expect(
      resolveBackgroundTaskShellCommand(
        { command: 'sentinel', shell: '   ' },
        { env: { ROBOTA_SHELL: '/bin/bash' }, platform: 'linux' },
      ),
    ).toEqual({ executable: '/bin/bash', args: ['-c', 'sentinel'] });
  });
});
