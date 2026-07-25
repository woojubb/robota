# @robota-sdk/pack-coding

Robota's **coding capability** as a single [`ICapabilityPack`](../agent-capability-pack) — the
additive-axis proof for ARCH-005 and robota's first capability pack.

```ts
import { assembleProduct } from '@robota-sdk/agent-product';
import { createCodingPack } from '@robota-sdk/pack-coding';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

declare const providerDefinitions: readonly IProviderDefinition[];
declare const provider: IAIProvider;

const product = assembleProduct({
  id: 'acme-assistant',
  providerDefinitions,
  provider,
  // robota's coding tools, /shell + /editor commands, and coding subagents — the file tools are
  // scoped to the cwd you build the pack with.
  packs: [createCodingPack({ cwd: process.cwd() })],
});
void product;
```

The pack bundles:

- **tools** — `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`,
  `AskUserQuestion` (the built-in coding tools, imported from `@robota-sdk/agent-tools` — not
  re-implemented).
- **commandModules** — `/shell` and `/editor` (the coding command modules).
- **subagents** — `general-purpose`, `Explore`, `Plan`.

The tool set mirrors `agent-framework`'s `createDefaultTools()` and is drift-pinned by a test, so the pack
cannot silently diverge from robota's actual default toolset.

## Why a factory, and why `cwd` is required

There is deliberately **no context-free `codingPack` constant**. `agent-tools` disarms its
working-directory path guard when `cwd` is `undefined`, so a pack built with no options would contribute an
**unsandboxed** `Read`/`Write`/`Edit` — harmless while the framework's own context-bound default tier wins,
but not once a product hands the whole tool surface to its packs with `defaultTools: []` (ARCH-006).
Requiring `cwd` makes that decision impossible to forget. See [`docs/SPEC.md`](./docs/SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
