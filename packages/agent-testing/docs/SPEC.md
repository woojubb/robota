# @robota-sdk/agent-testing — Package Specification

## Scope

The general **test framework / environment** for the Robota SDK (INFRA-020). It owns domain-free
test-environment tooling that has no other home — currently the PTY runner, and future shared scenario
helpers. Cohesion comes from the **placement rule** below (a written charter), not from the broad word
"testing": this package is deliberately NOT a catch-all bucket.

Current surface:

- **PTY runner** (TEST-007): `spawnPty` / `spawnPtyFixture` — drive any command (or a TSX fixture) in
  a real pseudo-terminal so Ink renders and reads input exactly as in a user terminal. Per-key paced
  input, marker/exit waiting, ANSI-stripped snapshots.

This package is published (`@robota-sdk/*` scope) so any package — or an external consumer — can import
the tooling as a `devDependency`.

## Charter & placement rule (INFRA-020)

What lives **here**: domain-free test-environment tooling with no single-package owner (the PTY runner;
future cross-cutting scenario helpers). Zero `@robota-sdk` runtime deps, so any package can depend down
onto it without a cycle.

What lives **elsewhere** (and must NOT move here):

| Artifact                                                      | Home                                     | Example                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contracts / interfaces (incl. the client-side `IAgentDriver`) | the relevant `agent-interface-*` package | `IAgentDriver` → `agent-interface-transport`                                                   |
| Test doubles for a contract X                                 | X's owning package `./testing`           | scripted provider → `agent-core/testing`; scripted-session → `agent-framework/testing`         |
| Driver adapters (implement `IAgentDriver`)                    | the module owning what they drive        | in-process → `agent-transport`; built CLI binary → `agent-cli`; remote → `agent-remote-client` |
| A module's own feature tests                                  | that module                              | agent-cli features → `agent-cli`                                                               |

**No re-export hub**: this package does not re-export the doubles/adapters above; authors import those
from their owners directly (avoids a pass-through layer).

## Boundaries

| Rule                      | Detail                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Zero `@robota-sdk` deps   | The PTY harness is pure `node-pty` + `tsx`; it has no `@robota-sdk` dependency, so it can be consumed from anywhere without cycle risk |
| Cross-cutting only        | Only utilities with no single-package home belong here; package-contract test surfaces stay in their package's `./testing`             |
| devDependency consumption | Consumers import it as a `devDependency`; it is never a runtime dependency of a shipped product                                        |
| No product assembly       | This package contains no agent/product assembly — it drives processes, it does not assemble agents                                     |

## Architecture Overview

```
agent-testing/src
  index.ts                ← barrel: spawnPty, spawnPtyFixture, types
  pty/
    spawn-pty.ts          ← real-PTY driver (node-pty) + tsx-fixture spawner
    __tests__/
      spawn-pty.test.ts   ← harness self-test (drives a trivial process)
```

The harness spawns a process in a real PTY via `@homebridge/node-pty-prebuilt-multiarch`. `spawnPty`
drives any command (e.g. a built CLI binary); `spawnPtyFixture` runs a TSX fixture through the
`tsx/esm` import hook (no build step). The returned `IPtyRunSession` exposes `sendKeys` (per-key
paced), `write`, `pressEnter`, `waitFor`, `snapshot`/`raw`, `expectExit`, and `dispose`.

## Type Ownership

| Type                   | File                   | Description                                        |
| ---------------------- | ---------------------- | -------------------------------------------------- |
| `IPtyRunOptions`       | `src/pty/spawn-pty.ts` | Options for `spawnPty` (command/args/cwd/env/size) |
| `IPtyRunSession`       | `src/pty/spawn-pty.ts` | The driving session surface                        |
| `ISpawnFixtureOptions` | `src/pty/spawn-pty.ts` | Options for `spawnPtyFixture`                      |

## Public API Surface

| Export                 | Kind     | Description                                                                                        |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `spawnPty`             | function | Spawn any command in a real PTY; returns an `IPtyRunSession`                                       |
| `spawnPtyFixture`      | function | Spawn a TSX fixture in a PTY via the `tsx/esm` import hook                                         |
| `IPtyRunOptions`       | type     | `spawnPty` options                                                                                 |
| `IPtyRunSession`       | type     | Driving session: `sendKeys`/`write`/`pressEnter`/`waitFor`/`snapshot`/`raw`/`expectExit`/`dispose` |
| `ISpawnFixtureOptions` | type     | `spawnPtyFixture` options                                                                          |

## Extension Points

Future cross-cutting test utilities (shared fixtures, scenario builders over the INFRA-019 programmatic
driver) can be added under their own `src/<area>/` directory and re-exported from `src/index.ts`.
Package-contract test surfaces must NOT move here — they belong in their package's `./testing` subpath.

## Error Taxonomy

`waitFor` and `expectExit` reject with an `Error` carrying a tail snapshot of the PTY output on
timeout. `dispose` is a no-op once the process has exited.

## Class Contract Registry

No classes. The harness is a pair of factory functions returning the `IPtyRunSession` object literal.

## Test Strategy

A self-test (`src/pty/__tests__/spawn-pty.test.ts`) drives a trivial process to pin the harness
contract (`waitFor` on a marker, `expectExit` returns the real code, paced `sendKeys` round-trips). The
real-world consumers are the PTY suites in `agent-transport-tui` (`*.ptytest.ts`, `*-pty-e2e.test.ts`),
which import this package.
