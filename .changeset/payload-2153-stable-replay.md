---
'@robota-sdk/agent-file-authority': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

PAYLOAD-2153: make external-payload replay stable across Linux, macOS, and Windows.

- Add the domain-free `@robota-sdk/agent-file-authority` leaf with bounded, root-relative reads over retained native handles and a typed, path-safe refusal taxonomy.
- Route session replay and framework project reads through the shared authority while preserving their existing domain-specific budgets, integrity checks, and error mappings.
- Package the pinned native bridge in clean-installed Node CLI archives and exact-host standalone Bun binaries, refusing unsupported or mismatched targets before artifact mutation.
