# @robota-sdk/agent-interface-session

The session contracts of the Robota SDK: what an interactive session is and what it exposes, the
events it emits, the handle a caller gets for one submitted turn, the record that persists a
session and the store port that loads it, and the in-process interaction channel a surface can talk
to a session through.

The package is mostly type declarations. Its few runtime exports are pure helpers over those types
(listed below); it contains no classes and no I/O. It builds on the other contract packages:
`@robota-sdk/agent-interface-execution` (background work), `@robota-sdk/agent-interface-command`
(commands) and `@robota-sdk/agent-interface-analytics` (usage).

## Installation

```bash
npm install @robota-sdk/agent-interface-session
```

## Usage

Code that drives a session depends on `IInteractiveSession`, not on the class that implements it:

```ts
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

async function ask(session: IInteractiveSession, prompt: string): Promise<string | undefined> {
  const turn = await session.submit(prompt);
  try {
    const result = await turn.completed;
    return result.response;
  } catch (error) {
    // The turn never ran: it was coalesced, dropped at queue capacity, or cancelled.
    if (isTurnNotRunError(error)) return undefined;
    throw error; // a real failure inside the turn
  }
}
```

A session runs one turn at a time and queues the rest. `submit()` returns an `ITurnHandle` whose
`completed` promise always settles: with this turn's result, or with a "turn did not run" error
that `isTurnNotRunError` recognizes.

## What it defines

| Area                                                        | Main types                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The session                                                 | `IInteractiveSession`, and the capability slices it is made of (`ISessionTurnSubmission`, `ISessionConversationRead`, `ISessionCommands`, `ISessionBackgroundTasks`, …) collected in `ISessionCapabilityMap` |
| Turns                                                       | `ITurnHandle`, `IExecutionResult`, `ITurnNotRunError`, `TTurnNotRunReason`, `TTurnSource`, `ISubmitOptions`                                                                                                  |
| Events                                                      | `IInteractiveSessionEvents`, `TInteractiveEventName`, `IPermissionRequestEvent`, `IAskRequestEvent`, `IPromptResolvedEvent`, `IBranchEvent`, `ISkillActivationEvent`, `IMemoryEvent`                         |
| Persistence                                                 | `IInteractiveSessionRecord`, `IInteractiveSessionStore`, `TSessionLoadOutcome` (valid, missing, corrupt or unsupported)                                                                                      |
| Interaction channel                                         | `IInteractionChannel`, `InteractionEvent`, `IAgentDriver`, `ICommandInfo`                                                                                                                                    |
| Drivers and co-driving                                      | `TDriverId`, `IPeerTurnContext`, `IUiIntentEvent`                                                                                                                                                            |
| Session listing, binding, loops, prompt history, compaction | `ISessionListing`, `ISessionBinder`, `ISessionLoopState`, `IPromptHistorySource`, `ICompactEvent`                                                                                                            |

Runtime exports:

| Export                                                                         | What it is                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `readAssistantReplies`, `readLastAssistantText`, `readToolCalls`, `readErrors` | Pure readers over an `InteractionEvent[]` stream             |
| `isTurnNotRunError`                                                            | Tells a "turn did not run" rejection from a real failure     |
| `isSessionChangeRefusal`, `SESSION_CHANGE_REFUSAL_CODES`                       | Recognize a refused session switch and list its reason codes |
| `SESSION_CAPABILITY_MEMBER_KEYS`                                               | The members each capability slice contributes to a session   |
| `OWNER_DRIVER_ID`, `AGENT_DRIVER_ID`                                           | Driver ids for the local operator and for autonomous turns   |

A driver id is for display and attribution only; it is never an authorization input.

## Test doubles: `@robota-sdk/agent-interface-session/testing`

The `./testing` subpath ships conformant doubles for code that consumes these contracts. It is
separate from the main entry so the doubles never land in a production bundle.

| Export                                                                                | What it does                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `createTestInteractiveSession(overrides?)`                                            | Returns a complete `IInteractiveSession` with inert defaults; each double has its own session id and every `submit()` handle settles |
| `createSessionCapabilityHost(capabilities)` (alias `createTestSessionCapabilityHost`) | Builds a host object from a partial set of capability slices, rejecting unknown slice names                                          |
| `readSessionCapability(host, key)`                                                    | Reads one slice as `{ provided: true, value }` or `{ provided: false }`                                                              |

```ts
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

const session = createTestInteractiveSession({ getCwd: () => '/tmp/project' });
```

Because the double is typed as `IInteractiveSession` without a cast, a test that uses it stops
compiling when the contract gains a member, instead of silently testing against an old shape.

## Where it sits

- Depends on `@robota-sdk/agent-core`, `@robota-sdk/agent-interface-analytics`,
  `@robota-sdk/agent-interface-command` and `@robota-sdk/agent-interface-execution`.
- `@robota-sdk/agent-framework` implements the session (`InteractiveSession`) and an in-process
  interaction channel (`ProgrammaticInteractionChannel`).
- `@robota-sdk/agent-session` persists session records (`NodeSessionStore` implements
  `IInteractiveSessionStore`).
- Transports (`@robota-sdk/agent-transport` and its `-http`, `-mcp`, `-ws` carriers), the UIs
  (`@robota-sdk/agent-ui-terminal`, `@robota-sdk/agent-ui-web`), `@robota-sdk/agent-command`,
  `@robota-sdk/agent-session-analytics` and `@robota-sdk/agent-interface-session-mobility` consume
  these types.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract: interaction channel, persistence, capability
  presence, turn identity, and the runtime-tool capability.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
