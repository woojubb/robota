---
'@robota-sdk/agent-capability-pack': minor
'@robota-sdk/agent-product': minor
---

ARCH-027 makes product and capability-pack composition contracts exhaustive and observable. Capability
pack merging now preserves accepted `id`/`title`/`description` metadata, rejects later duplicate pack ids
atomically through `rejectedPacks`, and includes the contributor `packId` on every capability collision.
`assembleProduct` projects all three result channels losslessly.

This is a beta-line breaking contract correction: `IProductProfile.providerOverride` is removed because
provider-name selection belongs to the shell's settings resolution, and capability rejection values now
require `packId`.
