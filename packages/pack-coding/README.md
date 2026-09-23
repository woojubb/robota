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
  // robota's coding tools, /shell + /editor + /git commands, and coding subagents — the file tools are
  // scoped to the cwd you build the pack with.
  packs: [createCodingPack({ cwd: process.cwd() })],
});
void product;
```

The pack bundles:

- **tools** — `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`,
  `AskUserQuestion` (consumed from `@robota-sdk/agent-tool-defaults#createDefaultTools`).
- **commandModules** — `/shell`, `/editor`, and `/git` (the coding command modules).
- **subagents** — `general-purpose`, `Explore`, `Plan`.

The pack calls the default-tool owner directly with its `cwd` and optional sandbox client. Its test checks
that composition does not add, drop, or reorder those tools.

## Why a factory, and why `cwd` is required

There is deliberately **no context-free `codingPack` constant**. The tool layer now refuses a missing
execution root; this factory also requires `cwd` so each pack's file tools are scoped to the session that
constructs it. A product can hand its whole tool surface to packs with `defaultTools: []` (ARCH-006).
See [`docs/SPEC.md`](./docs/SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
