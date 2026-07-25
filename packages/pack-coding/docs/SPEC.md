# pack-coding Specification

## Scope

Owns **robota's coding capability as a single `ICapabilityPack`** — the additive-axis proof for ARCH-005
and robota's first capability pack. `createCodingPack(options)` bundles the built-in coding tools, the
coding command modules, and the coding subagents into one additive composition unit that `assembleProduct`
can compose on top of any product's base command modules — and, since ARCH-006, that a product profile can
let OWN its entire tool surface. It re-uses the published `@robota-sdk/agent-tools` factories,
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

| Bucket           | Contents                                                                                             | Source                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `tools`          | `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `AskUserQuestion` | `@robota-sdk/agent-tools` factories             |
| `commandModules` | `agent-command-shell` (`/shell`), `agent-command-editor` (`/editor`)                                 | `@robota-sdk/agent-command`                     |
| `subagents`      | `general-purpose`, `Explore`, `Plan`                                                                 | `@robota-sdk/agent-framework` `BUILT_IN_AGENTS` |

**Tool-set fidelity.** The `tools` bucket is built with the caller's `ICodingPackOptions` and mirrors `agent-framework`'s `createDefaultTools()` ALWAYS-PRESENT
set. The adapter-gated tools (`CodebaseRetrieval`, `Computer`) are deliberately excluded — a pack is a
static bundle and those tools exist only when their adapter/driver is injected at session-assembly time.
The pack test pins the pack's tools to `createDefaultTools()` by name, so the pack cannot silently drift
from robota's actual default toolset (adding a default tool fails the test until the pack is updated).

**Command-module scope.** Only the capability-level coding command modules (`/shell`, `/editor`) are
bundled — NOT the product-shell/settings/provider command infrastructure (`/provider`, `/settings`,
`/preset`, …), which a product shell composes, not a coding capability pack.

## Session scoping — why this package exports a FACTORY and no constant (ARCH-006)

The pack is built by `createCodingPack({ cwd, sandboxClient })`. **There is deliberately NO module-level
`codingPack` constant**, and that absence is a safety property, not an omission:

- `agent-tools`' `checkPathWithinCwd` is a **no-op when `cwd` is `undefined`**. Tools constructed with no
  options therefore carry a **disarmed** working-directory guard — their `Read` will return
  `/etc/hostname`.
- Before ARCH-006 that was inert: `agent-framework` always built its own context-bound default tier, and
  its first-wins name dedupe kept that instance over a pack's.
- ARCH-006 lets a product hand the WHOLE tool surface to its packs (`defaultTools: []`). A context-free
  pack in that position is an **unsandboxed `Read`/`Write`/`Edit`**. A zero-option export would be a loaded
  gun aimed at the very seam this pack exists to demonstrate.

`cwd` is therefore **required**, so the scoping decision cannot be forgotten at a construction site. Pass
the same value the session is assembled with. `sandboxClient` is optional: when present the tools operate
through the sandbox and the host path guard does not apply, because the sandbox is the isolation boundary.

Each call returns **fresh instances** bound to the supplied context, so two products assembled in one
process get independently-scoped file tools.

> The removed `codingPack` constant was introduced in ARCH-005 S1 and is not carried forward in any
> deprecated form — the package is pre-release and every consumer moved to the factory in the same change.

## Public API Surface

| Export               | Kind      | Description                                                                                               |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `createCodingPack`   | Function  | Build the `ICapabilityPack` bundling robota's coding tools/commands/subagents, bound to a session context |
| `ICodingPackOptions` | Interface | The session context the pack binds to — `cwd` (required) and an optional `sandboxClient`                  |

## Test Strategy

`src/__tests__/coding-pack.test.ts` (vitest) asserts the pack contributes EXACTLY robota's current coding
toolset: the pack's tool names equal `createDefaultTools()` names (drift-pinned); subagents equal
`BUILT_IN_AGENTS`; command modules equal `['agent-command-shell', 'agent-command-editor']`; a stable id
(`coding`); and that the pack merges cleanly on top of an empty base via `mergeCapabilityPacks` with no
rejections.

**The scoping property is asserted by EXECUTION, not by inspection.** Four cases run the pack's own tools:
`Read`, `Write` and `Edit` each DENY a path outside the supplied `cwd` (`"outside the working directory"`),
and two packs built with different roots do not share a scope. A mutation dropping `cwd` from the tool
options fails all four. The `test` script runs `vitest run --passWithNoTests`.

## Class Contract Registry

This package contains no classes. It exports a single `const` capability-pack value assembled from
published tool factories, command-module factories, and the framework's built-in subagents. No abstract
classes or cross-package port implementations are defined here.

## Dependencies

- `@robota-sdk/agent-capability-pack` — the `ICapabilityPack` contract the pack conforms to.
- `@robota-sdk/agent-tools` — the built-in tool factories (imported, not re-implemented) and the
  `ISandboxClient` contract.
- `@robota-sdk/agent-command` — the `/shell` and `/editor` command-module factories.
- `@robota-sdk/agent-framework` — `BUILT_IN_AGENTS` (the coding subagents).
