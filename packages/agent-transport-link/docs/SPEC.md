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
- A runtime admits a spawner only with the spawner-key proof and an owner only with the attach-key
  proof, and closes the stream on any failure without saying why. A client sends only the request
  line and its hello before it has checked the runtime, and a link is open only once the runtime has
  announced its custody, which it does only after admitting the proof.
- An admitted link reports its standing, and the runtime's desk decides what that standing may do;
  the carrier never grants a request by itself.
- Every frame is bounded by what may come next before any of it is read, and every owner message
  decodes strictly on both ends. Anything else ends the link before a port sees it.
- Wire shapes stop in this package: runtimes and clients deal only in domain values (trust roots,
  read keys, custody states, session questions, control commands).
- A spawner gets its key from one exchange over the pair its runtime inherited. The runtime answers
  it synchronously, before it starts any child, and closes the descriptor on every path, including a
  failure; the spawner writes first and closes its own end once it has the key.
- A runtime that ends a link delivers what is already queued for the client, for a bounded grace,
  and sends and hears nothing further; a link reports the bytes its client has not yet taken, so the
  runtime can cut a client that stopped reading.
- A read grant reaches the runtime only as read keys handed to its desk, and the keys of a grant the
  desk refuses are locked.
- A refusal the runtime decided reaches the client with its fixed code and text; any other failure
  reaches it as `failed`, never with its own text.

## Invariants

- The session protocol crosses unchanged: a session frame carries one serialized `agent-transport`
  message, and the client decodes it with that package's decoders.
- When a link ends, for any reason, its frame keys are wiped and every request still waiting is
  rejected.
- No descriptor of a runtime's pair stays open once the runtime's end has returned, whatever the
  outcome; a descriptor that is not the pair is neither read nor closed.

## Non-goals

- Listeners of any kind: the carrier runs over a stream that is already connected.
- Browser use.
- Admission policy, custody and the accept decision itself; this package carries them.

## Design Decisions

- **Admission is a proof, never a token.** Anything bearer-shaped that a runtime accepts can be read
  or replayed by the programs this link exists to refuse; a proof tied to the passphrase, or to the
  exchange only the spawner took part in, cannot.
- **The runtime's end of the pair is synchronous.** A child started while the descriptor is open
  could inherit it and answer in the runtime's place. Libuv passes a POSIX child only the
  descriptors it was given, but a Windows child inherits every inheritable handle still open, so the
  close has to come before the first spawn and cannot be left to the platform. One synchronous
  call leaves no room between reading and closing for anything else to run.
- **The runtime's read of the pair has no deadline of its own.** A synchronous read of a blocking
  descriptor cannot be interrupted, and a deadline would protect no one: only the program that
  started the runtime can leave it waiting, by holding the pair open and saying nothing, and that
  costs only that program a runtime that never serves. Its own timeout destroys its end of the pair,
  which ends the read.
- **Ending a link flushes before it cuts.** A runtime ends a spawner's link right after answering
  the certification, and a link destroyed at once would drop that answer; the grace is bounded so a
  client that never reads cannot hold the socket open.
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
