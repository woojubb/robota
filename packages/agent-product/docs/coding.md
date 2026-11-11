# @robota-sdk/agent-product/coding

Robota's coding capability as a single
[`ICapabilityPack`](./capability-pack.md): the built-in coding tools, the coding command
modules, and the coding subagents in one unit that `assembleProduct` can add to any product.
`@robota-sdk/agent-cli` composes it for its coding assistant. The subpath is Node only.

## Installation

```bash
npm install @robota-sdk/agent-product
```

## Usage

```ts
import { createNodeFrameworkHost } from '@robota-sdk/agent-framework/node';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createCodingPack } from '@robota-sdk/agent-product/coding';
import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

declare const providerDefinitions: readonly IProviderDefinition[];
declare const provider: IAIProvider;

const cwd = process.cwd();
const product = assembleProduct({
  id: 'acme-assistant',
  providerDefinitions,
  // The coding tools, /shell + /editor + /git commands, and coding subagents. The file tools are
  // scoped to the cwd you build the pack with.
  packs: [createCodingPack({ cwd })],
});

const host = createNodeFrameworkHost({ createDefaultTools });
const session = product.buildRuntime({ session: { host, cwd, provider } });
void session;
```

The pack bundles:

- **tools** — `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`,
  `AskUserQuestion` (from `@robota-sdk/agent-tools/defaults`' `createDefaultTools`). When the
  `sandboxClient` has a separate filesystem, `Glob` and `Grep` are withheld, leaving seven.
- **commandModules** — `/shell`, `/editor` (from `@robota-sdk/agent-product/command/node`), and `/git` (from
  `@robota-sdk/agent-product/command`).
- **subagents** — `general-purpose`, `Explore`, `Plan` (agent-framework's built-in agents).

`createCodingPack` passes its `cwd`, `sandboxClient`, `editorFiles`, `shellExecutable` and
`httpUserAgent` options straight to the default tool factory, so the pack adds, drops, or reorders none
of those tools. `shellExecutable` also selects the shell for `/shell`; `editorTemporaryDirectoryPrefix`
and `editorUnavailableMessage` configure `/editor`. The pack's id is `coding`.

## Why a factory, and why `cwd` is required

There is deliberately **no context-free `codingPack` constant**. The tool layer refuses a missing
execution root, and this factory also requires `cwd` so each pack's file tools are scoped to the
session that constructs it. That matters most when a product hands its whole tool surface to packs by
passing `defaultTools: []` in the session options. See [SPEC.md](./SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
