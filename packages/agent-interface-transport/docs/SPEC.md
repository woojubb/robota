# agent-interface-transport Specification

## Scope

Owns the transport contract interfaces for the Robota SDK: the standard protocol for transport
adapters (WebSocket, HTTP, MCP, TUI, etc.) and their configurable lifecycle. This package is
contracts plus a small set of pure, dependency-free derivation accessors over its own owned union
types — no classes, no I/O, no side effects.

## Boundaries

- Contains type contracts and interfaces plus a small set of pure, dependency-free derivation
  accessors over its own owned union types — no classes, no I/O, no side effects.
- Depends only on `@robota-sdk/agent-core`, and only for types (`import type`) — the package emits
  zero runtime `@robota-sdk/*` dependencies.
- Depends on no other `agent-interface-*` package, across every published surface.
- Does not depend on `@robota-sdk/agent-framework` or any transport implementation package.
- Implementation packages (the transport-specific packages and the headless runner) depend on this
  package for interface types, directly from their contract owner, not through `agent-framework`.

Other contract families that once lived here (command, session, background-task, subagent,
background job-group, execution-workspace, peer messaging) have moved to the packages named for
them; this package no longer re-exports them. This package's own export surface is exactly what its
entry point declares — nothing broader is implied by its history as a former omnibus.

## Transport Admission

Admission (which peers may reach a session) was not a member of any contract, so each transport
package re-decided it independently and disagreed: two transports chose opposite defaults for
whether to require a credential, and a third had no gate at all. This package owns the decision so
there is one place to read and one place to change it — including the access-token admission a
remote resource server makes, whose verdict is a closed set of refusal reasons that never carries
token text or claim values, so logging a verdict cannot leak a credential or an identity.

The resolved decision is SECURE BY DEFAULT: an explicit token wins, otherwise one is minted. A
transport may still run open, but only by saying so explicitly, with a required written reason —
"no credential" and "nobody thought about it" must not be indistinguishable. Failing to mint a
token throws rather than silently returning an open admission, so a transport that cannot get
entropy fails to construct instead of binding without a gate.

Access-token admission is single-tenant by design: issuer, audience and scope alone admit anyone
the issuer serves, while the host hands one shared session to every admitted peer, so the
configuration must also name the subjects or clients allowed in. An external-event grant narrows
this to exactly one principal, because the grant is what the event is attributed to: a carrier only
moves the token and the event, and no sender name it or the payload carries is identity.

The functions that produce the decision (minting, comparison, token verification) live in a
separate Node-dependent package, not here: this package is inert by rule (no runtime dependency
edges), and those functions need Node builtins for entropy and the network. A transport with no
remote peer declares that admission does not apply to it in its own SPEC, rather than this package
asserting a universal default.

## Interface Contracts

### Adapter lifecycle

An adapter exposes a unique name, a required frozen lifecycle discriminant (`service` or
`runner`), `attach(session)`, `start()`, and `stop()`. The discriminant is required, not optional —
silence about which kind an adapter is was itself the defect: a runner used to run its entire
prompt inside `start()`, so a caller awaiting `start()` to move on to the next step could never
reach the point where a co-registered service actually started. Splitting the contract so a
runner's `start()` launches and returns, with completion awaited separately, removes that
ambiguity.

`start()` resolves at the concrete package's own documented readiness boundary. Calling `start()`
before `attach()`, or starting an already-active adapter, rejects rather than silently no-opping.
`stop()` is safe and bounded when called repeatedly, and a stopped adapter may be attached and
started again.

The bound form used by a registry (after a composition root binds a raw adapter to its exact
session type) carries no `attach` operation — the binding owner invokes the raw adapter's `attach`
once, before each start, after settings are configured. The registry never accepts a session or
stores a raw adapter directly.

A runner's completion outcome is exactly succeeded-with-zero-exit or failed-with-nonzero-exit, with
no raw underlying cause exposed through this contract. A registry aggregate may additionally record
abandonment (stopped, or rolled back during startup) for a runner that never reached that outcome;
a separate "first failure" wait reports only a genuine failure and does not treat normal stop-time
abandonment as a process failure.

One transport implementation (TUI) is deliberately outside this family: it ignores `attach()` and
constructs its own session, because it owns presentation and session lifecycle itself rather than
receiving a session from a host.

### Persisted configuration

A transport's persisted configuration is an enabled flag plus a free-form options bag, stored under
a per-transport-name key in the host's settings. A configurable transport additionally declares a
default-enabled value (used when no persisted value exists), an optional schema describing its
options (for a settings UI), and an optional validation function to run before applying
user-supplied options.

### Registry views

The registry is split into two orthogonal views: a lifecycle view (register, start all, wait for
completion, wait for first failure, stop all) that operates on any bound adapter, and a settings
view (list, enable/disable, set options) that operates only on configurable adapters. `stopAll()` is
best-effort — it never rejects; each transport is stopped independently and any per-transport
failure is reported in the returned result rather than thrown, so one transport's failure to stop
cannot block or hide another's.

### Payload channels

A transport may optionally host consumer-declared channels alongside its own built-in protocol, so
a domain protocol (e.g. a text-agent event stream) is one profile carried on the transport rather
than being the transport itself. A channel is declared with a unique name and its own event
vocabulary, with an opt-in flag for carrying opaque binary frames.

Binary frames carry bytes the transport never inspects; a sender-assigned, monotonically increasing
per-channel sequence number lets a receiver reassemble a chunked payload correctly regardless of
delivery order, and structured event frames share that same sequence space so interleaved binary
and event traffic has one total order. Routing an unroutable frame (unknown channel, undeclared
event, binary sent on a text-only channel, malformed envelope) is a stated error outcome, never a
silent drop.

Content-neutrality is a hard boundary here: nothing in this contract knows about audio, files, or
images. Domain-specific adapters are assembled by consumers on top of these contracts, never built
into this package.

## Error Taxonomy

This package owns the inert error shapes for lifecycle and configuration failures. Implementing
packages construct them; consumers discriminate by a stable name and code. No error class or
stateful runtime owner lives in this package.

## Constraints

- This package MUST NOT contain classes, I/O, or stateful/side-effecting runtime logic. The only
  runtime allowed beyond `interface`/`type` declarations is a small set of pure, dependency-free
  derivation accessors over this package's own owned union types.
- Zero runtime (emitted-JS) dependencies — all `@robota-sdk/*` imports are type-only, so no
  `@robota-sdk/*` package appears in the compiled output.
- Any new cross-cutting transport contract belongs here, not in an assembly package or an
  individual transport implementation.
