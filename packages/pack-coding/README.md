# @robota-sdk/pack-coding

Robota's coding capability as a single
[`ICapabilityPack`](../agent-capability-pack/README.md): the built-in coding tools, the coding command
modules, and the coding subagents in one unit that `assembleProduct` can add to any product. The
`robota` CLI uses it for its own coding assistant.

## Installation

```bash
npm install @robota-sdk/pack-coding
```

## Usage

```ts
import { assembleProduct } from '@robota-sdk/agent-product';
import { createCodingPack } from '@robota-sdk/pack-coding';
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

const session = product.buildRuntime({ session: { cwd, provider } });
void session;
```

The pack bundles:

- **tools** — `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`,
  `AskUserQuestion` (from `@robota-sdk/agent-tool-defaults`' `createDefaultTools`).
- **commandModules** — `/shell`, `/editor`, and `/git` (from `@robota-sdk/agent-command`).
- **subagents** — `general-purpose`, `Explore`, `Plan` (agent-framework's built-in agents).

`createCodingPack` passes its `cwd` and optional `sandboxClient` straight to the default tool factory,
so the pack adds, drops, or reorders none of those tools. Its other options are `shellExecutable` (the
shell for the tools and `/shell`) and `editorTemporaryDirectoryPrefix` (for `/editor`).

## Why a factory, and why `cwd` is required

There is deliberately **no context-free `codingPack` constant**. The tool layer refuses a missing
execution root, and this factory also requires `cwd` so each pack's file tools are scoped to the
session that constructs it. That matters most when a product hands its whole tool surface to packs by
passing `defaultTools: []` in the session options. See [`docs/SPEC.md`](./docs/SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
