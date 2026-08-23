# @robota-sdk/agent-interface-session-mobility — documents

Session mobility for the Robota SDK: moving messages between live sessions, and moving authority over
a session to another machine. Type declarations plus four discriminators — no policy, no transport.

## Usage

```typescript
import type { IPeerMessage } from '@robota-sdk/agent-interface-session-mobility';
import {
  isSameEnvironmentPeer,
  isHandoffCommitted,
} from '@robota-sdk/agent-interface-session-mobility';
// Discriminators over recorded state, not authorization checks. Wires are `agent-transport-*`.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, type ownership, boundaries, and why peer messaging and
  handoff are one axis rather than two families.
