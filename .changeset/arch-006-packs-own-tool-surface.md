---
'@robota-sdk/pack-coding': major
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-cli': minor
---

ARCH-006 completion — robota's capability packs now OWN its tool surface, and `pack-coding` is built by a
context-bound factory.

- **`@robota-sdk/pack-coding` (BREAKING)** — the module-level `codingPack` constant is **removed** and
  replaced by `createCodingPack({ cwd, sandboxClient })`, with `cwd` **required**. This is a safety change,
  not a style one: `agent-tools` disarms its working-directory path guard when `cwd` is `undefined`, so a
  pack whose file tools are built with no options contributes an **unsandboxed** `Read`/`Write`/`Edit`.
  That was inert while `agent-framework` always supplied its own context-bound default tier, but ARCH-006
  lets a product hand the whole tool surface to its packs (`defaultTools: []`) — and a context-free pack in
  that position is a real hole. Keeping a zero-option export beside that seam would be a loaded gun, so it
  is gone rather than deprecated. Each call returns fresh instances bound to the supplied context, so two
  products in one process get independently-scoped file tools. Migration: replace `codingPack` with
  `createCodingPack({ cwd: process.cwd() })`.
- **`@robota-sdk/agent-cli`** — `robota`'s packs are built from the shell's resolved `cwd`
  (`createRobotaPacks({ cwd })`) before command setup, and the runtime seam passes
  `ROBOTA_PACKS_OWN_TOOL_SURFACE` (an empty `defaultTools`) so the framework's `createDefaultTools()` tier
  is REPLACED. Every tool robota runs now arrives from a capability pack: dropping a pack drops its tools,
  exactly as it already dropped its command modules and subagents.
- **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
  `additionalTools` and `defaultTools` through the headless and TUI channels, mirroring the existing
  `agentDefinitions` pass-through, so print, serve and TUI carry an identical tool surface.

End-user `robota` behavior is unchanged, including the security property: the real binary still answers a
read outside the working directory with `Access denied: "…" is outside the working directory`.
