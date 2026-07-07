# Agent Testing

Test framework/environment tooling for the Robota SDK — currently a **PTY runner** that drives a
real command (or a TSX fixture) in a genuine pseudo-terminal.

## What layer does this test?

This package is for **real-binary / real-terminal E2E**: your CLI or Ink UI runs in an actual PTY,
renders real frames, and receives input keystroke-by-keystroke exactly as a user terminal delivers
it (burst writes get bundled by terminals as a bracketed paste — the exact failure mode this
harness exists to catch).

| You want to test…                                           | Use                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Agent/tool/plugin logic in isolation                        | Plain vitest + hand-rolled fake providers               |
| Deterministic agent runs without live API calls             | `@robota-sdk/agent-provider-replay` (scripted provider) |
| A terminal app end-to-end: rendering, key input, exit codes | **this package** (`spawnPty` / `spawnPtyFixture`)       |

If you are not spawning a process that draws to a terminal, you do not need this package.

> This package is **private** and not published to npm. It is internal to the Robota monorepo and
> used via workspace references.

## Usage

```typescript
import { spawnPty } from '@robota-sdk/agent-testing';

const session = spawnPty({
  command: 'node',
  args: ['./dist/cli.js', '--name', 'fixture'],
  cwd: process.cwd(),
});

// Assert only on output that arrives AFTER a mark — the stripped output is a
// cumulative transcript (old frames + the echo of your own typing also match).
const mark = session.outputOffset();
await session.sendKeys('hello');
await session.pressEnter();
await session.waitForSince(mark, /assistant:/i);

const exitMark = session.outputOffset();
await session.sendKeys('/exit');
await session.pressEnter();
const code = await session.expectExit();
console.log(code, session.snapshotSince(exitMark));
```

`spawnPtyFixture` runs a TSX fixture through the `tsx/esm` import hook (no build step) — the
pattern used for focused source-level E2E of Ink components.

## Key session APIs

| Member                               | Purpose                                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `sendKeys(text)`                     | Type per-key (default 35ms/key) to avoid bracketed-paste bundling |
| `pressEnter()` / `write(data)`       | Single keystroke / verbatim bytes for control sequences           |
| `outputOffset()`                     | Mark the cumulative transcript before acting                      |
| `waitForSince(mark, pattern)`        | Wait for output that arrived after the mark (ANSI-stripped)       |
| `snapshotSince(mark)` / `snapshot()` | Stripped output after the mark / full stripped output             |
| `expectExit()` / `raw()`             | Wait for exit with timeout / raw un-stripped output               |

## Links

- [GitHub](https://github.com/woojubb/robota)
