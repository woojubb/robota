# @robota-sdk/agent-interface-session — documents

Runtime session contracts for the Robota SDK: what an interactive session is and exposes, the channel
a surface talks to it through, the events it emits, the handle for one turn, and the record that
persists it.

## Usage

```typescript
import type {
  IInteractiveSession,
  ITurnHandle,
  InteractionEvent,
} from '@robota-sdk/agent-interface-session';
import { readAssistantReplies } from '@robota-sdk/agent-interface-session';
// Declarations, plus the pure accessors and discriminators the Interface Package Rule permits.
// Sessions are CONSTRUCTED in `agent-framework` and persisted by `agent-session`.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, boundaries, and why two tests stayed
  behind while a third moved here.
