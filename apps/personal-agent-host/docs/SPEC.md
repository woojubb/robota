# robota-personal-agent-host — SPEC

## Purpose

One server hosts many accounts, each with its own isolated instance of the personal agent, reachable only at
its own HTTPS address. The control plane owns the account lifecycle (add, suspend, resume, delete), the
per-account secrets, the audit trail and what the proxy serves. It treats the agent as an image: it runs
units and never links the agent's code, so the root-level daemon's trusted surface stays small.

## Contract

- **Everything runs through two ports.** Units are created, started, stopped and destroyed only through the
  runtime port, and sites are served only through the proxy port, both in plain JSON. The control plane can
  therefore run on a different host from the runtimes, and a backend can change without touching the account
  logic.
- **A unit's address comes from the port, never from localhost.** Routes are built from the endpoints the
  runtime reports, so no code path may assume the unit and the control plane share a machine.
- **The store is owner-only.** The state directory, the account file, each secret file and the audit log are
  readable by their owner alone. Writes are atomic; a store that is malformed or too open is refused, never
  repaired by starting empty.
- **Secrets are never output.** A model key is held in a file of its own and read only to start that account's
  unit. Listing and showing accounts never load it, and it appears in no result, audit line, error message,
  proxy configuration or unit description, including text an underlying runtime returns.
- **The guard fails closed.** No unit starts unless the network guard is verified, and a reconcile that cannot
  verify it stops every unit.
- **Only known hostnames are served.** An account is served only while its record says so; a suspended
  account answers 503 and is never proxied, and a deleted or half-made one is unknown.
- **A failed command leaves nothing half-made.** Every step of an add is undone on failure; a crash leaves at
  most a `provisioning` or `deleting` record, finished by removal at the next start and audited as recovered.
- **One operation at a time, every command audited.** Refusals and failures are recorded with their reason.
- **Strays are reported, never deleted.** A unit of this install with no record is surfaced for the operator.

## Invariants

- The hostname of an account is `<id>.<base domain>`, fixed when the account is created.
- An account id is a DNS label that is also safe in an engine object name.
- The container backend is used for an account only when the operator has allowed it by setting; a backend
  that is not built yet is refused.
- The account record never holds a credential; a provider URL that carries one is refused.

## Non-goals

Self-signup, billing, live migration, GPU, and disk quotas on containers. Accounts are created by the operator.

## Design decisions

- **Only the control plane starts units.** Units carry no restart policy, so the guard always precedes them.
- **The control plane holds each key and hands it over only at start.** A suspended account's key then exists
  only in the store; there is no encryption at rest, because its key would sit beside the file. Root on the
  runtime host can see a running unit's key, and the guide says so.
- **A guard that disappears while units run is reapplied, else every unit stops.** A unit must never keep
  running unguarded, and stopping is the fail-closed fallback when reapplying fails.
- **The stored hostname is checked for syntax, not against the configured domain.** The record's hostname is
  authoritative once created, so changing the configured base domain cannot make the store unreadable.
- **Zero runtime dependencies.** Node built-ins only, so the root daemon has no third-party code to trust.
- **A cleanup that cannot finish keeps the record.** The half-made account stays visible in `provisioning`
  rather than leaving an unrecorded unit behind.
- **An audit write that fails after its command completed does not fail the command.** The failure is
  counted and shown in status instead of reporting finished work as failed.
