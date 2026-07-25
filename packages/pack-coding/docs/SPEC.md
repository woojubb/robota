# pack-coding Specification

## Scope

Owns **robota's coding capability as a single `ICapabilityPack`** — the additive-axis proof for ARCH-005
and robota's first capability pack. `codingPack` bundles the built-in coding tools, the coding command
modules, and the coding subagents into one additive composition unit that `assembleProduct` can compose on
top of any product's base command modules. It re-uses the published `@robota-sdk/agent-tools` factories,
`@robota-sdk/agent-command` modules, and `@robota-sdk/agent-framework` subagents — it re-implements none of
them.

## Boundaries

- Does **not** re-implement or fork any tool, command module, or subagent — it imports the real published
  code objects.
- Does **not** assemble sessions, merge packs, or construct runtimes — that is `@robota-sdk/agent-product`.
- Does **not** self-activate. A pack contributes only when a product profile lists it (opt-in); every
  contributed command/tool runs only through the permission-gated runtime at call time.
- Is a **library** — a reusable, neutral bundle of general coding capabilities (file/shell tools, coding
  subagents), usable by any consumer building a coding assistant. It carries no product-specific business
  logic or product identity.

## Pack contents

| Bucket           | Contents                                                                                              | Source |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| `tools`          | `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `AskUserQuestion` | `@robota-sdk/agent-tools` factories |
| `commandModules` | `agent-command-shell` (`/shell`), `agent-command-editor` (`/editor`)                                  | `@robota-sdk/agent-command` |
| `subagents`      | `general-purpose`, `Explore`, `Plan`                                                                  | `@robota-sdk/agent-framework` `BUILT_IN_AGENTS` |

**Tool-set fidelity.** The `tools` bucket mirrors `agent-framework`'s `createDefaultTools()` ALWAYS-PRESENT
set. The adapter-gated tools (`CodebaseRetrieval`, `Computer`) are deliberately excluded — a pack is a
static bundle and those tools exist only when their adapter/driver is injected at session-assembly time.
The pack test pins `codingPack.tools` to `createDefaultTools()` by name, so the pack cannot silently drift
from robota's actual default toolset (adding a default tool fails the test until the pack is updated).

**Command-module scope.** Only the capability-level coding command modules (`/shell`, `/editor`) are
bundled — NOT the product-shell/settings/provider command infrastructure (`/provider`, `/settings`,
`/preset`, …), which a product shell composes, not a coding capability pack.

## Public API Surface

| Export       | Kind  | Description                                                        |
| ------------ | ----- | ----------------------------------------------------------------- |
| `codingPack` | Const | The `ICapabilityPack` bundling robota's coding tools/commands/subagents |

## Test Strategy

`src/__tests__/coding-pack.test.ts` (vitest) asserts the pack contributes EXACTLY robota's current coding
toolset: `codingPack.tools` names equal `createDefaultTools()` names (drift-pinned); subagents equal
`BUILT_IN_AGENTS`; command modules equal `['agent-command-shell', 'agent-command-editor']`; a stable id
(`coding`); and that the pack merges cleanly on top of an empty base via `mergeCapabilityPacks` with no
rejections. The `test` script runs `vitest run --passWithNoTests`.

## Class Contract Registry

This package contains no classes. It exports a single `const` capability-pack value assembled from
published tool factories, command-module factories, and the framework's built-in subagents. No abstract
classes or cross-package port implementations are defined here.

## Dependencies

- `@robota-sdk/agent-capability-pack` — the `ICapabilityPack` contract the pack conforms to.
- `@robota-sdk/agent-tools` — the built-in tool factories (imported, not re-implemented).
- `@robota-sdk/agent-command` — the `/shell` and `/editor` command-module factories.
- `@robota-sdk/agent-framework` — `BUILT_IN_AGENTS` (the coding subagents).
