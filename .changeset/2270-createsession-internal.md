---
'@robota-sdk/agent-framework': major
---

`createSession` and `ICreateSessionResult` are no longer exported from the package root.

**Migration.** Use `InteractiveSession`, or `createAgentRuntime().createSession(IHeadlessSessionOptions)`, or `createQuery()`. `createSession` was the low-level assembly seam, not the intended session entry point; the public surface is unchanged for every consumer that used one of those three.

Neither symbol appears in the published `3.0.0-beta.79` surface — the export was added after that release and never shipped — so no released consumer can be affected. That is recorded as a fact about impact, not as the reason for the removal: `.agents/project-structure.md` § Forward-Provisioned Surface Rule bans consumer-count reasoning about a public surface at any count. The reason is that the surface does not fit the design — `ICreateSessionOptions` is a 60-field internal projection target, and the 2026-03-26 SDK scope redesign already decided this factory is internal.

`ICreateSessionOptions` remains exported: four packages read indexed-access types off it as the option SSOT, and it is this package's own type.

Closes issue #2270's export half. Its no-opt-out half stays open against issue #2238 — this change does **not** make the unconditional executor seeding safe, and the SPEC deliberately declines to reinstate that argument even though the un-export makes it literally true again.
