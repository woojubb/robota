### Examples

Package-owned offline verification scenario for `@robota-sdk/agent-session`.

#### Files

- `verify-offline.ts`: Deterministic offline smoke run (no network, no provider keys) used by the
  scenario harness. Run with `pnpm scenario:verify`; re-record its authoritative output with
  `pnpm scenario:record`.
- `verify-session-record-field-preservation.ts`: ARCH-015 public-SDK scenario proving a raw
  `Session` re-save preserves resumable fields owned by other writers while refreshing its own fields.
- `verify-external-payload-replay.ts`: Provider-free public-SDK scenario proving that a valid sidecar
  replays on the current native host and that replacing its directory with a symlink or junction is
  refused. Run it directly with `pnpm scenario:verify:external-payload-replay`.
- `scenarios/offline-verify.record.json`: Recorded authoritative output consumed by
  `scripts/harness/verify-change.mjs` and `scripts/harness/collect-run-context.mjs`.

Embedding/demo examples live at the repository-root `examples/` layout (the layout SSOT — see
`.agents/project-structure.md`).
