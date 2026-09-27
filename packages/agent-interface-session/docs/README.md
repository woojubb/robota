# @robota-sdk/agent-interface-session — documents

Runtime session contracts for the Robota SDK: what an interactive session is and exposes, the
channel a surface talks to it through, the events it emits, the handle for one turn, and the record
and store port that persist it. Mostly type declarations, plus a few pure helpers (event-stream
readers such as `readAssistantReplies`, the `isTurnNotRunError` and `isSessionChangeRefusal`
predicates, and the driver-id constants).

## Usage

```typescript
import type {
  IInteractiveSession,
  ITurnHandle,
  InteractionEvent,
} from '@robota-sdk/agent-interface-session';
import { readAssistantReplies, isTurnNotRunError } from '@robota-sdk/agent-interface-session';
// Sessions are constructed in agent-framework and persisted by agent-session.
```

Test doubles live on a separate subpath, `@robota-sdk/agent-interface-session/testing`:
`createTestInteractiveSession` returns a complete `IInteractiveSession` with inert defaults, and
`createSessionCapabilityHost` / `readSessionCapability` build and read a host from a partial set of
capability slices.

## Documents

- [SPEC.md](./SPEC.md) — package contract, boundaries, and the decisions behind the interaction
  channel, session persistence, capability presence and turn identity.
