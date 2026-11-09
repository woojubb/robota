import { describe, expect, it } from 'vitest';

import { resolveShell } from '../resolve-shell.js';

describe('interactive shell host selection', () => {
  it('keeps the executable and argument family together', () => {
    const shell = resolveShell('C:\\Windows\\System32\\cmd.exe');
    expect(shell.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(shell.commandArgs('echo ok')).toEqual(['/d', '/s', '/c', 'echo ok']);
  });
});
