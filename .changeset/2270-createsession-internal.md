---
'@robota-sdk/agent-framework': major
---

`createSession` and `ICreateSessionResult` are no longer exported from the package root.

**Migration.** Use `InteractiveSession`, or `createAgentRuntime().createSession(IHeadlessSessionOptions)`, or `createQuery()`. `createSession` was the low-level assembly seam, not the intended session entry point; the public surface is unchanged for every consumer that used one of those three.

**Impact on published consumers differs between the two symbols, and the earlier draft of this note got it wrong.** Resolved against the published `3.0.0-beta.79` `dist/node/index.d.ts` (466 exported names), not against the source barrel:

- `createSession` is **absent** from the published surface. It was root-exported on 2026-08-16, after the 2026-07-06 release, so no released consumer can be calling it.
- `ICreateSessionResult` **is published** — root-exported since 2026-06-14 and present at the release commit. Removing it is a genuine break to the published type surface, which is what the `major` bump declares.

Neither fact is the reason for the removal. `.agents/project-structure.md` § Forward-Provisioned Surface Rule bans consumer-count reasoning about a public surface at any count. The reason is that the surface does not fit the design — `ICreateSessionOptions` is a 60-field internal projection target, and the 2026-03-26 SDK scope redesign already decided this factory is internal. The published-surface facts are recorded so a consumer can tell which removal can affect them, not to justify either.

`ICreateSessionOptions` remains exported: four packages read indexed-access types off it as the option SSOT, and it is this package's own type.

Closes issue #2270's export half. Its no-opt-out half stays open against issue #2238 — this change does **not** make the unconditional executor seeding safe, and the SPEC deliberately declines to reinstate that argument even though the un-export makes it literally true again.
