# @robota-sdk/agent-tool-defaults

The Robota SDK's built-in default tool set. `createDefaultTools()` builds the tools a Robota session
gets when its composition root supplies no tool list of its own, using the tool factories from
`@robota-sdk/agent-tools`. It implements no tool itself. File tools that run on the host are
contained by the `cwd` you pass; with a `sandboxClient` that has its own filesystem, file paths go to
the sandbox and `cwd` does not confine them. Adapter-gated tools appear only when you supply their
adapter. Import it at a composition root (the place that assembles an agent), not from library code.

## Installation

```bash
npm install @robota-sdk/agent-tool-defaults @robota-sdk/agent-core
```

## Usage

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';

declare const provider: IAIProvider;

const agent = new Robota({
  name: 'DevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: createDefaultTools({ cwd: process.cwd() }),
});
```

`createDefaultTools()` is synchronous and performs no I/O, and the same options always produce the
same set of tools. Most tools are built fresh on each call; `WebFetch` and `WebSearch` are shared
instances.

## Tools

| Tool                       | Included when                                                   |
| -------------------------- | --------------------------------------------------------------- |
| `Shell`, `Bash`            | Always                                                          |
| `Read`, `Write`, `Edit`    | Always                                                          |
| `Glob`, `Grep`             | Unless a `sandboxClient` with a separate filesystem is supplied |
| `WebFetch`, `WebSearch`    | Always                                                          |
| `AskUserQuestion`          | Always                                                          |
| `CodebaseRetrieval`        | `retrievalAdapter` is supplied                                  |
| `ComputerView`, `Computer` | `computerDriver` is supplied                                    |

With a `sandboxClient`, `Shell` and `Bash` run commands through the sandbox. When the sandbox has
its own filesystem (the default for a client that does not declare `filesystem: 'shared'`), `Read`,
`Write` and `Edit` also go through it, and `Glob` / `Grep` are left out because they have no
sandbox path. File paths are then passed to the sandbox as given, and `cwd` does not confine them.
When the sandbox shares the host filesystem, file tools stay on the host, contained by `cwd`.

## Options

`createDefaultTools(options: ICreateDefaultToolsOptions): FunctionTool[]`

| Option             | Type                | Description                                                                                                                                                                |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`              | `string`            | Required. The root that host file tools are contained by (not file tools routed to a separate-filesystem sandbox), and the default working directory for `Shell` / `Bash`. |
| `sandboxClient`    | `ISandboxClient`    | Runs commands (and, on a separate filesystem, file tools) in a sandbox.                                                                                                    |
| `shellExecutable`  | `string`            | Host-selected executable for `Shell` and `Bash`.                                                                                                                           |
| `retrievalAdapter` | `IRetrievalAdapter` | Adds the `CodebaseRetrieval` tool.                                                                                                                                         |
| `computerDriver`   | `IComputerDriver`   | Adds the `ComputerView` and `Computer` tools. There is no host fallback.                                                                                                   |

`ISandboxClient`, `IRetrievalAdapter` and `IComputerDriver` are exported by
`@robota-sdk/agent-tools`.

## Related packages

- [`@robota-sdk/agent-tools`](../agent-tools/README.md): the tool factories, the tool registry and
  the sandbox clients.
- [`@robota-sdk/agent-core`](../agent-core/README.md): the `Robota` agent and the tool contract.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
