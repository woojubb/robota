# pack-coding Specification

## Purpose

Robota's coding capability as a single `ICapabilityPack` — the additive-axis proof for ARCH-005 and
robota's first capability pack. `createCodingPack(options)` bundles the default coding tools, coding
command modules, and coding subagents into one additive composition unit that `assembleProduct` can
compose on top of any product's base command modules — and, since ARCH-006, that a product profile
can let own its entire tool surface. It imports the real published tools/commands/subagents; it
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

### Session scoping — why a factory, not a constant (ARCH-006)

The pack is built by `createCodingPack({ cwd, sandboxClient })`. There is deliberately no
module-level `codingPack` constant, and that absence is a safety property, not an omission:

- A tool constructed with no `cwd` used to carry a disarmed working-directory guard. ARCH-010
  inverted that: the guard now refuses when no root is configured, and `cwd` is required by the tool
  factories themselves. This pack's rule is no longer the only thing standing between a context-free
  construction and an unsandboxed `Read`, but it remains right, and is why the pack was already
  correct when the audit found three layers that were not.
- Before ARCH-006 the hole was inert here: the framework always built its own context-bound default
  tier, and first-wins name dedupe kept that instance over a pack's.
- ARCH-006 lets a product hand its whole tool surface to its packs (`defaultTools: []`). Before
  ARCH-010, a context-free pack in that position exposed unsandboxed file tools; the current tool
  layer refuses a missing root, and this factory requires `cwd` at assembly as an additional
  contract.

`cwd` is therefore required, so the scoping decision cannot be forgotten at a construction site —
callers pass the same value the session is assembled with. `sandboxClient` is optional: when present,
tools operate through the sandbox and the host path guard does not apply, because the sandbox is the
isolation boundary. Each call returns fresh instances bound to the supplied context, so two products
assembled in one process get independently-scoped file tools.

> The removed `codingPack` constant was introduced in ARCH-005 S1 and is not carried forward in any
> deprecated form — the package is pre-release and every consumer moved to the factory in the same
> change.
