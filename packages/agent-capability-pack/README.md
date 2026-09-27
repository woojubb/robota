# @robota-sdk/agent-capability-pack

The **additive capability-bundle contract** for the Robota SDK: the `ICapabilityPack` type and the pure
`mergeCapabilityPacks` merger.

An `ICapabilityPack` is the _additive_ composition unit of a Robota product: a plain data record of named
capability buckets — command modules, tools, and subagents — that a consumer brings on top of a product's
base command modules. It is the additive analog of [`@robota-sdk/agent-preset`](../agent-preset/README.md): where a
preset dials **behavior** (persona, permission posture, subtractive tool/command selection), a pack
contributes **capability** (new tools, command modules, subagents).

## Installation

```bash
npm install @robota-sdk/agent-capability-pack
```

## Usage

```ts
import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';
import type { ICommandModule } from '@robota-sdk/agent-framework';

declare const baseCommandModules: readonly ICommandModule[];

const jiraPack: ICapabilityPack = {
  id: 'acme-jira',
  tools: [], // their Jira FunctionTool[]
  commandModules: [], // their /jira command module
};

const { merged, acceptedPacks, rejected, rejectedPacks } = mergeCapabilityPacks(
  baseCommandModules,
  [jiraPack],
);
void merged;
void acceptedPacks;
void rejected;
void rejectedPacks;
```

A pack has an `id`, optional `title` and `description` for discovery, and any of the `commandModules`,
`tools`, and `subagents` buckets.

`mergeCapabilityPacks` is a **pure, deterministic, IO-free fold**. It produces the `base ⊕ pack` superset
plus accepted pack metadata and distinct capability/pack rejection channels. A later duplicate pack id is
rejected atomically in `rejectedPacks`; a capability whose id collides with an already-claimed id is
reported with its contributor `packId` in `rejected` — never silently overridden. See
[`docs/SPEC.md`](./docs/SPEC.md) for the full contract.

A pack carries **executable code objects** (command handlers, tool `execute` functions), not serialized
JSON. Packs are opt-in (present only when a product profile lists them), the merge is pure, and any
contributed command/tool runs only through the permission-gated runtime at call time.

Most consumers do not call `mergeCapabilityPacks` directly: they list packs in an
[`@robota-sdk/agent-product`](../agent-product/README.md) profile, and `assembleProduct` merges them.
[`@robota-sdk/pack-coding`](../pack-coding/README.md) is a complete, working pack.

## License

AGPL-3.0-only OR LicenseRef-Commercial
