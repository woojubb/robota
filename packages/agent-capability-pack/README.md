# @robota-sdk/agent-capability-pack

The **additive capability-bundle contract** for the Robota SDK.

An `ICapabilityPack` is the _additive_ composition unit of a Robota product: a plain data record of named
capability buckets — command modules, tools, and subagents — that a consumer brings on top of a product's
base command modules. It is the additive analog of [`@robota-sdk/agent-preset`](../agent-preset): where a
preset dials **behavior** (persona, permission posture, subtractive tool/command selection), a pack
contributes **capability** (new tools, command modules, subagents).

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

`mergeCapabilityPacks` is a **pure, deterministic, IO-free fold**. It produces the `base ⊕ pack` superset
plus accepted pack metadata and distinct capability/pack rejection channels. A later duplicate pack id is
rejected atomically in `rejectedPacks`; a capability whose id collides with an already-claimed id is
reported with its contributor `packId` in `rejected` — never silently overridden. See
[`docs/SPEC.md`](./docs/SPEC.md) for the full contract.

A pack carries **executable code objects** (command handlers, tool `execute` functions), not serialized
JSON. Packs are opt-in (present only when a product profile lists them), the merge is pure, and any
contributed command/tool runs only through the permission-gated runtime at call time.

## License

AGPL-3.0-only OR LicenseRef-Commercial
