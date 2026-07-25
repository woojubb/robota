# @robota-sdk/pack-coding

Robota's **coding capability** as a single [`ICapabilityPack`](../agent-capability-pack) — the
additive-axis proof for ARCH-005 and robota's first capability pack.

```ts
import { assembleProduct } from '@robota-sdk/agent-product';
import { codingPack } from '@robota-sdk/pack-coding';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const product = assembleProduct({
  id: 'acme-assistant',
  provider,
  packs: [codingPack], // robota's coding tools, /shell + /editor commands, and coding subagents
});
void product;
```

`codingPack` bundles:

- **tools** — `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`,
  `AskUserQuestion` (the built-in coding tools, imported from `@robota-sdk/agent-tools` — not
  re-implemented).
- **commandModules** — `/shell` and `/editor` (the coding command modules).
- **subagents** — `general-purpose`, `Explore`, `Plan`.

The tool set mirrors `agent-framework`'s `createDefaultTools()` and is drift-pinned by a test, so the pack
cannot silently diverge from robota's actual default toolset. See [`docs/SPEC.md`](./docs/SPEC.md).

## License

AGPL-3.0-only OR LicenseRef-Commercial
