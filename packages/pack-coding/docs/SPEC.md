# pack-coding Specification

## Scope

Owns **robota's coding capability as a single `ICapabilityPack`** — the additive-axis proof for ARCH-005
and robota's first capability pack. `createCodingPack(options)` bundles the built-in coding tools, the
coding command modules, and the coding subagents into one additive composition unit that `assembleProduct`
can compose on top of any product's base command modules — and, since ARCH-006, that a product profile can
let OWN its entire tool surface. It consumes `@robota-sdk/agent-tool-defaults#createDefaultTools`,
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
| `tools`          | `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `AskUserQuestion` | `@robota-sdk/agent-tool-defaults`               |
| `commandModules` | `agent-command-shell` (`/shell`), `agent-command-editor` (`/editor`), `agent-command-git` (`/git`)   | `@robota-sdk/agent-command`                     |
| `subagents`      | `general-purpose`, `Explore`, `Plan`                                                                 | `@robota-sdk/agent-framework` `BUILT_IN_AGENTS` |

**Tool-set fidelity.** The factory passes the caller's `cwd` and optional `sandboxClient` directly to
`@robota-sdk/agent-tool-defaults#createDefaultTools()`. It does not maintain a separate tool list.
The adapter-gated tools (`CodebaseRetrieval`, `Computer`) are absent because this pack supplies neither
adapter nor driver. The test checks that composition adds, drops, and reorders no defaults; name equality
is not a substitute for the source-level ownership relationship.

**Command-module scope.** Only the capability-level coding command modules (`/shell`, `/editor`, `/git`) are
bundled — NOT the product-shell/settings/provider command infrastructure (`/provider`, `/settings`,
`/preset`, …), which a product shell composes, not a coding capability pack.

## Session scoping — why this package exports a FACTORY and no constant (ARCH-006)

The pack is built by `createCodingPack({ cwd, sandboxClient })`. **There is deliberately NO module-level
`codingPack` constant**, and that absence is a safety property, not an omission:

- `agent-tools`' `checkPathWithinCwd` USED TO BE a no-op when `cwd` was `undefined`. Tools constructed
  with no options therefore carried a disarmed working-directory guard — their `Read` returned
  `/etc/hostname`. **ARCH-010 inverted that**: the guard now refuses when no root is configured, and
  `cwd` is required by the tool factories themselves. This pack's rule is no longer the only thing
  standing between a context-free construction and an unsandboxed `Read` — but it remains right, and
  it is why the pack was already correct when the audit found three layers that were not.
- Before ARCH-006 the hole was inert here: `agent-framework` always built its own context-bound default
  tier, and its first-wins name dedupe kept that instance over a pack's.
- ARCH-006 lets a product hand the whole tool surface to its packs (`defaultTools: []`). Before
  ARCH-010, a context-free pack in that position exposed unsandboxed file tools. The current tool layer
  refuses a missing root, and this factory requires `cwd` at assembly as an additional contract.

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

`src/__tests__/coding-pack.test.ts` (vitest) asserts the pack contributes the current default coding
toolset without adding, dropping, or reordering tools; subagents equal `BUILT_IN_AGENTS`; command modules
equal `['agent-command-shell', 'agent-command-editor', 'agent-command-git']`; a stable id
(`coding`); and that the pack merges cleanly on top of an empty base via `mergeCapabilityPacks` with no
rejections.

**The scoping property is asserted by execution, not inspection.** Six cases run the pack's own tools:
`Read`, `Write`, `Edit`, `Glob`, and `Grep` each deny a path outside the supplied `cwd`, and two packs
built with different roots do not share a scope. Dropping `cwd` from the tool options fails these cases.
The `test` script runs `vitest run --passWithNoTests`.

## Class Contract Registry

This package contains no classes. It exports the context-bound `createCodingPack(options)` factory, which
assembles a fresh capability pack from default tools, command-module factories, and built-in subagents. No abstract
classes or cross-package port implementations are defined here.

## Dependencies

- `@robota-sdk/agent-capability-pack` — the `ICapabilityPack` contract the pack conforms to.
- `@robota-sdk/agent-tool-defaults` — the default tool set consumed by the factory.
- `@robota-sdk/agent-tools` — the `ISandboxClient` type contract.
- `@robota-sdk/agent-command` — the `/shell`, `/editor`, and `/git` command-module factories.
- `@robota-sdk/agent-framework` — `BUILT_IN_AGENTS` (the coding subagents).
