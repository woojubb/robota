# agent-transport-acp Specification

## Purpose

Agent Client Protocol (ACP) v1 agent transport for the Robota SDK. An editor that launches the
process drives one session over newline-delimited JSON-RPC: it prompts, watches streamed output and
tool calls, answers permission requests and cancels turns. The ACP SDK dependency and all
ACP-specific vocabulary stay in this package, so a protocol revision touches one place.

## Boundaries / Non-goals

- Does not build sessions, decide workspace trust, or run slash commands. The host attaches the
  session and injects the trust check and the command port; command execution belongs to the
  framework layer this package may not import.
- Depends on `agent-transport` (shared stdio carrier helper), the `agent-interface-*` contracts,
  `agent-core` types and the ACP SDK. It imports no sibling transport, no `agent-framework` and no
  CLI. Carrier mechanics shared with MCP live in `agent-transport/node`, not here and not copied.
- Does not delegate file reads, writes or terminals to the editor, replay history (`session/load`),
  or advertise MCP capability, and speaks no ACP version other than 1.
- Is not Robota's own surface protocol. The WebSocket wire protocol serves session listing and
  switching, history paging, background work, status frames and pairing that ACP v1 has no
  counterpart for; this adapter sits beside it over the same session.

## Contract

- **Lifecycle.** A frozen `service`. Start before attach and a repeated active start reject; stop
  is idempotent and clears the session, so restart needs a new attach. `waitForClose()` settles when
  the editor's input ends, the output closes or the transport stops, and rejects if the output fails.
- **Only protocol on the wire.** The carrier writes JSON-RPC frames and nothing else; the host
  reserves the output so no other writer can reach it.
- **Updates precede the reply.** A prompt answers only after every update for it has been written.
- **One answer per prompt.** `end_turn` when the turn completes, `cancelled` after `session/cancel`
  or when the editor goes away, otherwise a fixed error that withholds provider text.

## Invariants

- **The editor widens nothing.** `session/new` must name the served directory and carry no MCP
  servers or extra roots; the host's trust check runs before the session id is returned. A
  permission answer grants only an option that request listed, and anything cancelled, failed or
  unrecognised denies.
- **Questions fail closed.** ACP v1 has no free-form question, so the transport never listens for
  one and the session answers it as cancelled.
- **Every session event has a decision.** The event policy is exhaustive over the shared vocabulary
  and the subscription is derived from it, so a new event fails compilation until it is decided.
- **The process input outlives the transport.** The SDK reads a bridge, and stopping releases the
  bridge and its listeners but never destroys the real input or output.
- **A turn's outcome comes from its own handle.** Streaming uses session events; the stop reason
  uses the submission's turn handle.

## Design decisions

- **One session per connection.** The host builds one session, with its trust, working directory
  and permissions. Serving a second `session/new` would alias that session under another id or need
  a session factory whose per-session working directory is not established, so it is refused.
- **`cwd` must equal the served directory.** The session is rooted when it is built; accepting
  another directory would claim a root the tools do not have. Symlinked spellings of the same
  directory are accepted.
- **Editor-supplied `mcpServers` and extra roots are refused.** They would add servers to launch or
  files to reach that the user did not configure for this agent. MCP servers are configured in the
  agent's own settings.
- **Trust is answered inside `session/new`.** The headless trust gate exits before any protocol
  traffic, which an editor shows as a crash with no explanation; answering with an error that names
  the command to run tells the user what to do. The error's code is server-defined, never ACP's
  authentication-required one, which an editor turns into a sign-in state this agent does not have.
- **Initialize always answers version 1.** The protocol has the agent answer with the version it
  supports and the client disconnect if it cannot use it, so an unknown requested version is not an
  error here.
- **Stop reason comes from the turn handle.** A session-wide `complete` or `interrupted` says that a
  turn ended, never which one; the handle names its own turn. A reply that was not streamed (a
  provider without deltas) is sent once from the result.
- **Tool calls are keyed by the session's execution id when it has one, otherwise by a counter.**
  The editor keeps earlier calls and identifies them by id, so ids must not repeat across turns; the
  counter lives as long as the connection. The session asks permission before it reports a call and
  the permission event names none, so the request carries an id derived from the request and that
  row becomes the call's row: the next call of the same tool reported after the editor answered
  takes it, or its refusal closes it. The match is by tool name in the order asked because nothing
  else links them. A row nothing claimed by the end of the turn is closed rather than left pending.
- **A permission request shows what the terminal shows.** The person answers in the editor's dialog
  alone, so the request carries the arguments whole, an edit's diff and the file it touches, and a
  title that is never shortened; approving a summary would approve what was not seen.
- **Slash commands arrive as prompt text.** A prompt whose text starts with `/` goes to the host's
  command port and its output is one message; the editor's own command list is not advertised.
- **No thought stream.** The session's thinking event carries no text, so there is nothing to send.
- **Turn failures reply with a fixed message.** Provider errors can contain request details; the
  cause goes to the host callback instead.
- **The output is a plain sink, not a stream adapter.** Node's stream-to-Web adapter keeps
  listeners on the process output and can destroy it; the transport adds neither.
- **Usage surface is `unknown`.** The shared surface vocabulary has no editor value.
