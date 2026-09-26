---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

External-event grants are given at start, carried exactly to a background session, listed without their
principal, and revoked by the owner.

- `agent-framework` (breaking) — `openExternalEventSource` and `ExternalEventIngress.open` take `createVerifier`
  instead of a verifier: the session builds each grant's verifier from `grant.verifier`, and an option that
  supplies a verifier is refused. `IExternalEventSource.revoke()` stops the grant's queued and running turns,
  refuses its later events as `grant-revoked`, and keeps the label from being opened again. A submission the
  session refuses is `shutting-down` only while it shuts down, and `session-unavailable` otherwise. New command
  host adapter `externalEvents` (`ICommandExternalEventsAdapter`).
- `agent-interface-transport` — `TExternalEventRefusal` gains `session-unavailable`.
- `agent-command` — `/events` lists the session's grants (label, principal kind, state, counts) and
  `/events revoke <grant-id>` withdraws one. User-only.
- `agent-cli` — a grant file (`grantId`, `issuer`, `resource` ending in `/events/<grantId>`, exactly one of
  `subject` or `client`, `scopes`, optional `algorithms` and `rate`) is validated before anything starts, with a
  reason that names the grant and no configured value. `robota --external-event-grant <file>` (TUI) and
  `robota session start --background --external-event-grant <file>` open every grant or fail the start; a
  background session receives its grants through a private file, opens them before it reports ready, and the
  launcher refuses a readiness that names other grants. `robota session events list <id> [--json]` and
  `robota session events revoke <id> <grant-id>` work over the generation-bound control socket, and
  `robota session list --format json` shows each grant's counts. The retired `--external-event-allow` now points
  at `--external-event-grant`.
