# @robota-sdk/agent-interface

Type contracts for the Robota SDK, one subpath per family. A package that implements a session
handler, a command, a transport adapter or a terminal interaction imports the contract from here,
and a package that consumes one does the same, so neither depends on the other's implementation.

The contracts are type declarations, with a few pure accessors and discriminators over their own
types. The one family that carries behavior, `session-mobility`, does no I/O.

## Installation

```bash
npm install @robota-sdk/agent-interface
```

`@robota-sdk/agent-core` is an optional peer dependency. The `session`, `command`, `execution` and
`transport` contracts name its types, and `session-mobility` names them through `session`, so install it
next to them; the `analytics` and `tui` subpaths need nothing.

## Subpaths

There is no root export: import the subpath of the family you use.

| Subpath                                         | Contracts                                                                  | Document                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `@robota-sdk/agent-interface/session`           | Interactive sessions, interaction channels, events, turns, session records | [docs/session.md](docs/session.md)                   |
| `@robota-sdk/agent-interface/session/testing`   | Test doubles for the session contracts                                     | [docs/session.md](docs/session.md)                   |
| `@robota-sdk/agent-interface/session-mobility`  | Peer messaging and session handoff between sessions and devices            | [docs/session-mobility.md](docs/session-mobility.md) |
| `@robota-sdk/agent-interface/command`           | Commands, command results, plugin adapters, capability descriptors         | [docs/command.md](docs/command.md)                   |
| `@robota-sdk/agent-interface/execution`         | Background tasks, job groups, subagent jobs, execution workspaces          | [docs/execution.md](docs/execution.md)               |
| `@robota-sdk/agent-interface/analytics`         | Usage snapshots, per-source totals, run-trace timelines                    | [docs/analytics.md](docs/analytics.md)               |
| `@robota-sdk/agent-interface/transport`         | Transport adapters, admission, access tokens, external events              | [docs/transport.md](docs/transport.md)               |
| `@robota-sdk/agent-interface/transport/testing` | Test doubles for the transport contracts                                   | [docs/transport.md](docs/transport.md)               |
| `@robota-sdk/agent-interface/tui`               | Terminal UI interaction contracts                                          | [docs/tui.md](docs/tui.md)                           |

```ts
import type { IInteractiveSession } from '@robota-sdk/agent-interface/session';
import type { ITransportAdapter } from '@robota-sdk/agent-interface/transport';
```

## Layering

`session` composes `analytics`, `command` and `execution`; `session-mobility` composes `session`;
the other subpaths import no subpath. A subpath imports only itself, `@robota-sdk/agent-core` and
the entry of a lower subpath, and a test holds that.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract, invariants and decisions of the package and of each family.
- [`docs/`](docs/README.md) — one page per subpath: usage and the exported names.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
