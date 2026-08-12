---
'@robota-sdk/agent-framework': major
---

**BREAKING — RUNTIME-006: align the exported concrete `InteractiveSession.submit` options with the
transport-owned `IInteractiveSession` contract.**

The concrete class no longer exposes framework-internal turn metadata through its fourth argument;
public callers may pass only `ISubmitOptions` (`driverId`). New public and internal submissions
always mint a fresh turn identity. An already accepted queued submission now resumes through a
private required-identity path instead of re-entering public `submit`, so runtime extra properties
cannot select or reuse another turn's identity.

Queued entries, execution, and every settle/fail/refuse operation now require `turnId`. The former
undefined no-op guards and the alternate settler lookup seam are removed, preserving the contract
that every accepted handle settles for its own turn or typed refusal.
