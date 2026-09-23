# SPEC.md — @robota-sdk/agent-interface-execution

## Purpose

Owns the execution-bounded contract families — background tasks, background job groups, subagent
jobs, and execution workspaces — shared between the runtime that schedules execution and the surfaces
that display it. Type declarations only: no class, no runtime logic, no mechanism. A consumer that
wants behavior depends on an owner package; this one gives it the vocabulary to describe the
behavior.

## Boundaries

Not owned here:

| Concern                                                    | Owner                                     |
| ---------------------------------------------------------- | ----------------------------------------- |
| Session, interaction, event, turn and driver contracts     | `agent-interface-session`                 |
| Command contracts                                          | `agent-interface-command`                 |
| Transport adapter, config, channel and admission contracts | `agent-interface-transport`               |
| The runtime that executes a background task                | `agent-executor`, `agent-subagent-runner` |
| Persisting or projecting execution state                   | `agent-session`, `agent-transport-*`      |

## Invariants

- **Layer 0**: depends on no peer `agent-interface-*` package. Composition runs downward into it
  (e.g. `agent-interface-session` names these types); this package never names a session type.
- A `kind: 'scheduled'` background-task request carries no `permissionPolicy`, by decision (issue
  #2354): a schedule with `agentInstruction` wakes the host session rather than spawning an agent, and
  the woken turn runs under that session's own permission configuration. Only `kind: 'agent'` — a
  separate agent — declares a policy. A dedicated test enforces this.
- `IBackgroundTaskError` describes the shape of a failure that crossed a boundary; this package
  throws nothing and decides no recovery policy itself.
- No runtime value is exported, only types. The Interface Package Rule would allow publishing a
  contract's vocabulary/discriminator as a runtime value; this package currently needs neither.

## Design decisions

### Forking a conversation into a background task (CLI-1994)

`IAgentBackgroundTaskRequest.resumeSessionId?` names a persisted session record the child restores
before its first turn — how a fork (a copy of a live conversation, written under a fresh id by
`/fork`) reaches a background job. Only the id travels; the conversation itself never crosses the
child-process wire. `IBackgroundTaskState.resumeSessionId?` carries it onto the task's state so a
surface can tell a fork's task from an ordinary one; absent, the child starts with an empty
conversation.

A fork is a copy, not a branch of one live thing: from the moment the record is written the two
conversations are separate records that never rejoin. `TExecutionControl` gains `'attach'` for
exactly that reason — attaching to a fork is a view switch onto its record, never a merge.

## Non-goals

None by design: a contract package is extended by amending a declaration, not by subclassing or
registering. A consumer needing a narrower shape declares it in its own package and states how it
relates to the type here.
