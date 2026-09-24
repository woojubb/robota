# pack-coding Specification

## Purpose

Robota's coding capability as a single `ICapabilityPack` — the proof that capabilities compose
additively, and robota's first capability pack. `createCodingPack(options)` bundles the default coding tools, coding
command modules, and coding subagents into one additive composition unit that `assembleProduct` can
compose on top of any product's base command modules — including when a product profile lets it own
the entire tool surface. It imports the real published tools/commands/subagents; it
re-implements none of them.

## Non-goals

- Does not re-implement or fork any tool, command module, or subagent.
- Does not assemble sessions, merge packs, or construct runtimes — that is `@robota-sdk/agent-product`.
- Does not self-activate: a pack contributes only when a product profile lists it, and every
  contributed command/tool still runs only through the permission-gated runtime at call time.
- Is a neutral, reusable library of general coding capabilities usable by any consumer building a
  coding assistant — it carries no product-specific business logic or identity.
- Bundles only the capability-level coding command modules (`/shell`, `/editor`, `/git`) — not the
  product-shell/settings/provider command infrastructure, which a product shell composes, not a
  coding capability pack.

## Contract

- The factory passes the caller's `cwd` and optional `sandboxClient` straight through to the default
  tool factory; it does not maintain a separate tool list, so pack composition adds, drops, or
  reorders no defaults relative to that source.
- Adapter-gated tools (`CodebaseRetrieval`, `Computer`) are absent because this pack supplies neither
  adapter nor driver.

## Design decisions

### Session scoping — why a factory, not a constant

The pack is built by `createCodingPack({ cwd, sandboxClient })`. There is deliberately no
module-level `codingPack` constant, and that absence is a safety property, not an omission:

- A product may hand its whole tool surface to its packs (`defaultTools: []`), so the pack's tools can
  be the only file tools a session has. Without either guard, a context-free pack in that position would
  expose file tools with no working-directory root.
- The tool layer itself refuses a missing root; requiring `cwd` here is a second, assembly-time
  guarantee rather than the only one.

`cwd` is therefore required, so the scoping decision cannot be forgotten at a construction site —
callers pass the same value the session is assembled with. `sandboxClient` is optional: when present,
tools operate through the sandbox and the host path guard does not apply, because the sandbox is the
isolation boundary. Each call returns fresh instances bound to the supplied context, so two products
assembled in one process get independently-scoped file tools.
