---
'@robota-sdk/agent-product': minor
---

`@robota-sdk/agent-product/personal` adds the standard channel contract, so any messenger plugs into a personal agent as an adapter. An adapter declares its platform's capabilities and the sender each message came from. The channel hub admits only the owner's verified sender ids, runs turns through a port the host supplies, sends approvals as structured actions (or as a pointer to the feed when the platform has none), and accepts an approval only as the owner's structured action. The package includes an in-memory fixture adapter for tests.
