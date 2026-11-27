# Roundtable Agent Client Protocol Adapter

## Purpose

Let any agent that speaks the Agent Client Protocol take turns in an `@robota-sdk/agent-roundtable`
conversation as one more participant, without `agent-roundtable` depending on the protocol and
without a host writing an adapter for each agent product. The agent keeps its own memory, tools and
model; the roundtable sees only what it says.

## Contract

Only a turn's shared increment, the messages the participant has not already consumed, goes to the
agent as its next prompt. The conversation's purpose is announced once, on the turn that opens it.
A message's own content cannot be read back as a new header or a new turn boundary: whatever a peer
wrote stays data, quoted, never authority. What the agent thinks, plans, calls or reports about its
own usage never leaves it; the turn's contribution is the text it says in reply, and nothing the
agent did not finish saying is published.

A turn the agent ends itself is a contribution when it said something and a yield when it said
nothing. Any other ending fails the turn, whether the reply was cut short, the prompt was refused, the
turn was cancelled by someone other than the host, or the reply outgrew the bound the host set for
it, because publishing it would present an incomplete or withheld reply as the agent's own.

A host abort ends the wait and the session, and never produces partial text. The host is answered at
once; the agent is asked to cancel, given a short time to say so, and then disconnected. Stopping the
wait does not stop the agent, which may still be working on that turn, so a session that has been
aborted takes no further turns, even when the agent acknowledged the cancellation: it fails closed
rather than risk mixing that work into a later answer. A reply that outgrows its bound ends the same
way, because an agent that is still talking cannot be trusted afterwards.

The adapter lends the agent no authority of the host's. It advertises no client capability, so the
agent cannot reach the host's files or terminals through the connection; every request the agent
makes of the client other than a permission request is refused as unknown. A permission request is
refused unless the host supplied an approver and it allowed that one call, and then only for that
call: nothing is ever granted for the rest of the session. A request the approver is still weighing
when the turn ends is cancelled, and a late answer is ignored. What the agent can do on its own is
set by how it is started and configured, which is the host's decision and outside this package.

The participant declares that it makes no metered model calls, offers no checkpoint and no wait
continuation. A roundtable's model-call limits therefore never bound it, and a conversation holding
it cannot be loaded back once it has taken a turn: the agent's memory lives in another process that
this package cannot snapshot, and rebuilding it from the public transcript would silently give a
different agent. Nothing is ever parked for it.

The session core starts no process. Whatever yields the byte streams to an agent, and ends them,
sits behind a port, and a session's connection lives and ends with its lease. One launcher for that
port ships with the package: it starts the agent as a child process, gives it exactly the
environment the host names and nothing inherited, and ends the whole tree it started when the
connection closes or the agent exits, including helpers that outlive it or ignore the request. An agent that cannot be started fails the open with a typed error. Opening is
bounded by the adapter's own startup limit because the roundtable gives opening no cancellation.

It speaks version 1 of the protocol only and uses only its stable parts. An agent that answers with
another version is refused, not downgraded.

## Invariants

The agent's private history and tool traces never enter the shared transcript; only a turn's own
final text does, and only once it is non-empty after trimming. A delta the agent streamed is always
delivered, in the order it streamed, before the turn's outcome is returned. A session runs one turn
at a time. Releasing a session is safe to repeat and ends its connection once. The package reads no
environment variable, home directory, working directory or product configuration: everything it
needs is given to it, including every variable a launched agent sees.

## Non-goals

This package does not sandbox an agent process, supervise it beyond ending the tree its launcher
started, decide what an agent may do, meter or price what an agent spends, or recover an agent that
a crash interrupted mid-turn. It does not guard against its own host dying: an agent that does not
exit when its input ends outlives a crashed host. It is the
client side of the protocol only, so it does not make Robota an agent for editors, and it does not
follow a draft protocol version.

## Design decisions

- A refusal fails the turn instead of yielding. A refused prompt is dropped from the agent's own
  history, so a yield would leave the agent silently out of step with what the roundtable considers
  delivered to it.
- Model calls are declared as none rather than metered with an estimate. The protocol gives no
  per-call visibility, and a guessed figure would read as a guarantee a limit cannot keep; the
  ceiling on what an agent spends is the turn and time limits plus its own configuration.
- The turn renderer and the ordered delta queue are written here rather than taken from the adapter
  that runs Robota sessions or promoted into `agent-roundtable`. The parent package excludes
  presentation policy, and a shared home would widen its contract for one formatting choice; the same
  vectors pin both copies instead.
- No client capability is advertised. An agent that asked its client for files or a terminal would
  act under the host's authority; with none offered, those stay inside the agent's own process,
  under its own configuration.
- An approval is for one call, never for a class of calls. An agent's own "always" options would
  outlive the host's decision and the turn that asked for it, so they are never chosen, and an allow
  with only those on offer is a refusal.
- An acknowledged cancellation still ends the session. The agent's own history then holds a turn the
  roundtable never published, which is the same desynchronisation that makes a refusal fail.
- The agent is reached through a launcher port rather than a command line. The adapter stays free of
  how an agent is started, whether as a child process, in a container or somewhere remote, and a
  test can run a protocol-complete agent in memory.
- The launcher hands the agent only the environment it is given, never the host's. An agent started
  with ambient variables would carry credentials and settings the host never chose to share, so the
  host names what the agent needs, and a missing variable fails visibly in the agent rather than
  leaking silently.
- The agent runs in its own process group where the platform has one, and closing ends the group.
  Agents routinely start helpers of their own; ending only the agent would leave them running with
  its authority after the session is gone.
- The working directory the agent is told to use is an explicit input. Deriving it from the current
  process would make the same configuration mean different things in different hosts.
- The protocol SDK is a required peer at one exact version, shared with the host. The SDK shapes
  what goes on the wire, so a second copy or a drifting range could change it unnoticed, and a
  protocol-level upgrade is a decision of its own.
- The startup limit belongs to the adapter, and a connection that arrives after it is ended on
  arrival, because nothing else can cancel a launch the roundtable has stopped waiting for.
