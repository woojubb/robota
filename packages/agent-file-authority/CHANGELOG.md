# @robota-sdk/agent-file-authority

## 3.0.0-beta.80

### Minor Changes

- fcb0da3: PAYLOAD-2153: make external-payload replay stable across Linux, macOS, and Windows.

  - Add the domain-free `@robota-sdk/agent-file-authority` leaf with bounded, root-relative reads over retained native handles and a typed, path-safe refusal taxonomy.
  - Route session replay and framework project reads through the shared authority while preserving their existing domain-specific budgets, integrity checks, and error mappings.
  - Expose the canonical safe session-id predicate through the framework facade so CLI exact-session lookup stays within the SDK package boundary.
  - Package the pinned native bridge in clean-installed Node CLI archives and exact-host standalone Bun binaries, refusing unsupported or mismatched targets before artifact mutation.

## 3.0.0-beta.79

### Minor Changes

- Add the initial stable root-relative file-read authority.
