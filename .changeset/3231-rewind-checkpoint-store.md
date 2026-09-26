---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-framework': minor
---

`/rewind` works again. Every session the CLI builds for a trusted workspace captures edit
checkpoints; before, none did, and `/rewind` failed everywhere with "Edit checkpoints require
project authority."

- `agent-cli` (patch): a trusted workspace composes an edit checkpoint store for the terminal UI, a
  print run, a served runtime and each session a daemon keeps live. Pooled sessions each get their
  own store, since they can run turns at the same time. On a host that cannot prove a project write
  stays inside the project (every platform but Linux), none is composed: a checkpoint could be
  neither saved nor restored there.
- `agent-command` (patch): where a session has no checkpoints, `/rewind` says why: a restricted
  workspace is told to run `robota trust`, and a host that cannot write the project safely says so.
  `/rewind list` reports this as a failed command instead of throwing.
- `agent-framework` (minor): a checkpoint operation on a session without a store throws
  `EditCheckpointsUnavailableError`, whose `reason` is `host-cannot-write-project`,
  `restricted-workspace` or `no-checkpoint-store`. It is a `WorkspaceAuthorityRequiredError`, as
  before. `HeadlessInteractionChannel` takes an `editCheckpointStore` option.
