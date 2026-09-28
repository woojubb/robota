### Examples

Package-owned offline scenarios for `@robota-sdk/agent-session`. None of them needs a network
connection or a provider key. `pnpm scenario:verify` from this package runs all the TypeScript ones.

#### Files

- `verify-offline.ts`: Deterministic offline smoke run of a `Session` with a mock provider.
- `verify-session-record-field-preservation.ts`: Shows that when a `Session` re-saves an existing
  record, it keeps the resumable fields other writers own and refreshes only its own.
- `verify-compaction-contract.ts`: Runs a manual and an automatic compaction and checks that the
  hooks receive the matching `manual`/`auto` trigger and that every event written to the session log
  is part of `SESSION_LOG_EVENT`.
- `verify-hook-outcome-contract.ts`: Shows the `PreToolUse` gate: a denying hook, a hook that fails
  to start and a hook with an undecodable answer all block the tool call, and an allowing hook lets
  it run.
- `verify-external-payload-replay.ts`: Shows that a valid payload file replays on the current host
  and that replacing its directory with a symlink or junction is refused. Run it alone with
  `pnpm scenario:verify:external-payload-replay`.
- `verify-session-history-migration.mjs`: Runs the legacy session-history migration script against
  disposable files. Run it with `node examples/verify-session-history-migration.mjs`.

Embedding and demo examples live in the repository-root `examples/` directory.
