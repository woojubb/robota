# robota-personal-agent-host — SPEC

## Purpose

One server hosts many accounts, each with its own isolated instance of the personal agent, reachable only at
its own HTTPS address. The control plane owns the account lifecycle (add, suspend, resume, upgrade, delete), the
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
- **Secrets are never output.** A model key enters through stdin or a hidden prompt, never an argument or the
  environment, is held in a file of its own and is read only to start that account's unit. Listing and showing accounts never load it, and it appears in no result, audit line, error message,
  proxy configuration or unit description, including text an underlying runtime returns.
- **An account runs the image recorded for it.** The configured unit image is resolved to an image id when an
  account is added or upgraded, so rebuilding a tag never changes a running account. An upgrade is proven
  healthy before it is recorded; otherwise the previous image is started again and the account stays on it.
- **A backup is a consistent copy that never holds a key, and a restore changes nothing until the whole archive
  is proven.** Only a stopped unit gives a consistent copy, so the unit is stopped for it and started again from
  its recorded image. The archive is the account's state plus a manifest with a content hash; restore targets an
  existing account, keeps its stored key, and refuses another account's backup without an explicit flag. Paths,
  links, special files, size and hash are checked in full before anything is replaced, and a failed restore or
  restart puts the previous state back.
- **The guard fails closed.** No unit starts unless the network guard is verified, and a reconcile that cannot
  restore it stops every unit. A guard removed while units run leaves them unguarded until the next reconcile
  pass: normally within one interval after the previous pass, and longer while a backup, restore or upgrade holds
  the control plane, which health also waits behind.
- **A unit never reaches what a provider reserves for its host.** Besides private, link-local, carrier-grade NAT
  and reserved ranges, the denied destinations include a cloud provider's host-agent address that sits on a public
  address, because the provider's own filtering does not see forwarded traffic.
- **Only known hostnames are served, and only they get a certificate.** An account is served only while its
  record says so; a suspended account answers 503 and is never proxied, and a deleted or half-made one is
  unknown. The proxy configuration has no catch-all site, no on-demand issuance and no default certificate, so
  an unknown name fails the TLS handshake.
- **Nothing unvalidated reaches the proxy configuration.** Every hostname, address, port, email and path is
  checked first and a bad value is refused, never escaped, so no input can add a directive to it. A
  configuration the proxy does not accept is never written and the proxy keeps the last good one.
- **A failed command leaves nothing half-made.** Every step of an add is undone on failure; a crash leaves at
  most a `provisioning` or `deleting` record, finished by removal at the next start and audited as recovered.
- **Commands arrive over an owner-only Unix socket and nothing else.** No port is opened, so only the
  operator's own user can reach the control plane. A second server on the same state directory is refused, and
  the CLI is merely a client of that socket.
- **One operation at a time, every command audited.** Refusals and failures are recorded with their reason,
  and so is a request rejected before it became a command (without its body). Request bodies are strict: an
  unknown field is an error, never ignored.
- **A script can rely on the exit code.** Done, failed, usage, refused, no such account, unreachable and an
  unhealthy host each have their own code, and every refusal carries a typed error code.
- **Health is one answer a monitor can act on.** It is true only when the guard is verified, the routes are
  current and every active account's unit is running, healthy and on its recorded image, and otherwise names each
  problem. It reads live state and repairs nothing, the guard included, and so does status: they verify the guard without reapplying it, so a guard that went missing is reported until it is restored. Only the reconcile loop and the guard-first step of a start reapply the guard, and status says what the loop did.
- **Strays are reported, never deleted.** A unit of this install with no record is surfaced for the operator.

## Invariants

- The hostname of an account is `<id>.<base domain>`, fixed when the account is created.
- An account id is a DNS label that is also safe in an engine object name.
- `serve` starts only with a backend: the in-memory fake runs solely behind a setting named for tests and
  development.
- The container backend is used for an account only when the operator has allowed it by setting, because
  containers share the host's kernel and have no disk quota, so it is for trusted accounts; a backend that is not
  built yet is refused.
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
  authoritative once created, so changing the configured base domain cannot make the store unreadable; status
  reports a record whose domain differs and never rewrites it.
- **The socket bind is the single-instance lock.** A socket file counts as stale only when a connection to it is
  refused; anything else at that path (a regular file, another user's socket, a listener that does not answer)
  is left alone and refused, and only one start at a time may replace a stale one.
- **A unit's container exists only while it runs.** The engine fixes a container's environment when it is
  created, so the key goes in at start and leaves with the container at stop; the volume and network stay, and a
  unit that is destroyed is checked by label to leave nothing behind.
- **The engine is spoken to through its API, not its command line.** Hardening fields are asserted in tests, no
  client binary is needed in the control-plane image, and the same channel reaches a remote engine.
- **The guard is applied and read back by a short-lived helper container, and counts only while it reads back
  as applied.** The helper keeps the control plane off the host network and works against a remote engine; a table
  this process did not apply is unverified, so every start of the control plane reapplies it. Only drops are
  relied on, because a drop in a base chain is final whatever another firewall manager accepts.
- **The agent keeps binding loopback, and a byte forwarder inside the unit makes it reachable.** A sidecar loses
  its network when the unit restarts, and a bind-address option would touch the transports the single-account
  bundle shares and drop the loopback-only property; the image runs the forwarder only when the host asks.
- **A rollback leaves the record on the previous image.** The reconcile loop restarts from the record, so an
  upgrade that could not be proven never becomes what a restart runs; the access-code helper likewise uses the
  recorded image, never one tied to when the volume was made, which an upgrade may have pruned.
- **The runtime port streams state archives, the one exception to plain JSON.** State is large, so a remote
  adapter maps the stream to a streamed body instead of buffering it.
- **Archives wait in a private spool inside the state directory.** The manifest comes first and carries a hash of
  the entries, and a restore must see all of an archive before replacing anything, so neither can be done in one
  pass over a pipe; the spool is private, size-limited (`PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES`) and emptied by the
  server that holds the single-instance lock.
- **The installed wrapper tells the CLI when the operator's stdout is a terminal.** The CLI runs inside the control
  plane, where its stdout is a pipe even when the operator's is a screen, and a backup must never write an archive
  to a screen; a terminal is allocated only when both ends are one, because it would rewrite the archive's bytes.
- **Zero runtime dependencies.** Node built-ins only, so the root daemon has no third-party code to trust.
- **A cleanup that cannot finish keeps the record.** The half-made account stays visible in `provisioning`
  rather than leaving an unrecorded unit behind.
- **An audit write that fails after its command completed does not fail the command.** The failure is
  counted and shown in status instead of reporting finished work as failed.
- **Certificates are issued per listed hostname, not on demand.** Accounts are created by the operator, so
  every hostname is known when the configuration is generated and no approval endpoint is needed; a wildcard
  certificate stays a later, owner-chosen mode because it needs DNS-provider credentials.
- **The proxy is configured through its admin socket, never a TCP port.** On a host-network proxy a TCP admin
  port is reachable by every local process and every container, and whoever reaches it can reroute any account
  or obtain certificates; an owner-only socket limits that to the control plane. The proxy loads a
  configuration first and the file is written only once it was accepted, so the file is always one the proxy has
  proven; the generator is the only author of the file.
- **Units stay out of the compose project that installs the host.** An image built by compose carries the
  project's labels and a container inherits them, so units and helpers blank those labels; otherwise stopping
  the bundle would treat them as its own services. The proxy mounts only its own subdirectory of the state, so
  the internet-facing process never sees a key.
- **Live streams outlive a reload.** Closing a WebSocket delays by minutes after a reload, so adding or deleting
  one account does not cut the others' sessions.
- **A route is built only from a reported address.** A running unit with no address is served as unavailable
  rather than proxied to a placeholder, and an upstream that is loopback, unspecified or a single label is
  refused, so no route can reach a service on the proxy's own host.
