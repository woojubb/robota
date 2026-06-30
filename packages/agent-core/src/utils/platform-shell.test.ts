import { describe, expect, it } from 'vitest';

import { resolvePlatformShell } from './platform-shell.js';

describe('resolvePlatformShell', () => {
  describe('posix (darwin/linux)', () => {
    it('honors $SHELL when set and classifies bash', () => {
      const shell = resolvePlatformShell({ SHELL: '/bin/bash' }, 'linux');
      expect(shell.command).toBe('/bin/bash');
      expect(shell.kind).toBe('bash');
      expect(shell.platform).toBe('linux');
      expect(shell.commandArgs('echo hi')).toEqual(['-c', 'echo hi']);
      expect(shell.interactiveArgs).toEqual([]);
    });

    it('falls back to /bin/sh when $SHELL is unset and classifies sh', () => {
      const shell = resolvePlatformShell({}, 'darwin');
      expect(shell.command).toBe('/bin/sh');
      expect(shell.kind).toBe('sh');
      expect(shell.syntaxHint).toMatch(/POSIX/);
    });

    it('names the OS family in the hint so the model avoids cross-OS flag mistakes', () => {
      // macOS = BSD userland, Linux = GNU coreutils; the hint must call out which.
      expect(resolvePlatformShell({}, 'darwin').syntaxHint).toMatch(/macOS|BSD/);
      expect(resolvePlatformShell({}, 'linux').syntaxHint).toMatch(/Linux|GNU/);
      expect(resolvePlatformShell({}, 'darwin').label).toContain('darwin');
    });

    it('ignores an empty/whitespace $SHELL', () => {
      const shell = resolvePlatformShell({ SHELL: '   ' }, 'linux');
      expect(shell.command).toBe('/bin/sh');
    });
  });

  describe('win32', () => {
    it('defaults to PowerShell with -Command args', () => {
      const shell = resolvePlatformShell({}, 'win32');
      expect(shell.command).toBe('powershell.exe');
      expect(shell.kind).toBe('powershell');
      expect(shell.platform).toBe('win32');
      expect(shell.commandArgs('Get-ChildItem')).toEqual([
        '-NoProfile',
        '-Command',
        'Get-ChildItem',
      ]);
      expect(shell.label).toMatch(/PowerShell/);
      expect(shell.syntaxHint).toMatch(/PowerShell/);
    });

    it('routes a cmd.exe override to cmd /c', () => {
      const shell = resolvePlatformShell(
        { ROBOTA_SHELL: 'C:\\Windows\\System32\\cmd.exe' },
        'win32',
      );
      expect(shell.kind).toBe('cmd');
      expect(shell.commandArgs('dir')).toEqual(['/d', '/s', '/c', 'dir']);
    });

    it('treats a non-cmd override as PowerShell-compatible', () => {
      const shell = resolvePlatformShell({ ROBOTA_SHELL: 'pwsh.exe' }, 'win32');
      expect(shell.command).toBe('pwsh.exe');
      expect(shell.kind).toBe('powershell');
    });
  });

  describe('ROBOTA_SHELL override (posix)', () => {
    it('wins over $SHELL', () => {
      const shell = resolvePlatformShell(
        { ROBOTA_SHELL: '/usr/bin/zsh', SHELL: '/bin/bash' },
        'linux',
      );
      expect(shell.command).toBe('/usr/bin/zsh');
      expect(shell.kind).toBe('sh'); // not bash → generic sh family
    });
  });
});
