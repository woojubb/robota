### Examples

Package-owned offline verification scenario for `@robota-sdk/agent-core`.

#### Files

- `verify-offline.ts`: Deterministic offline smoke run (no network, no provider keys) used by the
  scenario harness. Run with `pnpm scenario:verify`; re-record its authoritative output with
  `pnpm scenario:record`.
- `scenarios/offline-verify.record.json`: Recorded output for this package-owned offline scenario.

Embedding/demo examples live in the repository-root `examples/` directory.
