# @robota-sdk/agent-transport-link — Package Specification

## Purpose

The owner link carrier: how a client reaches a served runtime on its own machine when nothing but
cryptography tells who is at either end. Programs running as the same operating-system user can
connect to a runtime's control socket, take it over, replay what they saw and start runtimes of
their own, so this package carries `@robota-sdk/agent-keyring`'s owner link over a local byte stream
(a supervised runtime's control socket or pipe) and owns the owner vocabulary spoken inside it. It
is a Node host package and runs unchanged on Node.js and Bun.

What each standing may do, when a runtime locks, where the read keys go and how the control
endpoint reads the request line stay with the runtime that serves the link.

## Contract

- One request line in the control endpoint's request shape opens a link, so the endpoint routes it
  like any other command. The line names no runtime and no start: the binding is proven inside the
  handshake, never taken from the request.
- A runtime admits a spawner only with the proof established over their inherited channel and an owner
  only with the attach-key proof; it closes the channel before a child can inherit it. The stream closes
  on proof failure without saying why, and the client discloses no proof before verifying the runtime.
- An admitted link reports its standing, and the runtime's desk decides what that standing may do;
  the carrier never grants a request by itself.
- Every frame is bounded by what may come next before any of it is read, and every owner message
  decodes strictly on both ends. Anything else ends the link before a port sees it.
- Wire shapes stop in this package: runtimes and clients deal only in domain values (trust roots,
  read keys, custody states, session questions, control commands).
- A read grant reaches the runtime only as read keys handed to its desk, and the keys of a grant the
  desk refuses are locked.
- A refusal the runtime decided reaches the client with its fixed code and text; any other failure
  reaches it as `failed`, never with its own text.

## Invariants

- The session protocol crosses unchanged: a session frame carries one serialized `agent-transport`
  message, and the client decodes it with that package's decoders.
- When a link ends, its queued answers may finish within a bounded grace while further traffic is
  refused; its frame keys are wiped and unanswered requests are rejected. This lets certification
  be acknowledged without retaining the spawner's authority.

## Non-goals

- Listeners of any kind: the carrier runs over a stream that is already connected.
- Browser use.
- Admission policy, custody and the accept decision itself; this package carries them.

## Design Decisions

- **Admission is a proof, never a token.** Anything bearer-shaped that a runtime accepts can be read
  or replayed by the programs this link exists to refuse; a proof tied to the passphrase, or to the
  exchange only the spawner took part in, cannot.
- **The custody notice opens the link.** The runtime sends it only after admitting the proof, so a
  client never mistakes a runtime that refused it for an open link.
- **Owner requests are their own frame kind.** Only a link endpoint's own code sends them; a renderer
  or an attached terminal speaks session frames, so no session message can be read as an owner
  decision.
- **A refused request leaves the link open; a malformed one closes it.** A refusal is the runtime's
  decision about a well-formed request. A frame that does not decode on an authenticated link means
  the peer is broken or not what it claims, and nothing it sends next can be trusted.
- **Encoders check their own output.** An end never sends what the other must refuse, so a value
  outside the vocabulary is its caller's error and not a closed link.
