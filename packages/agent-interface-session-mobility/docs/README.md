# @robota-sdk/agent-interface-session-mobility — documents

Session mobility for the Robota SDK: moving messages and files between live sessions, and moving
authority over a session to another machine. Besides the contracts, the package ships the logic
that must behave the same everywhere: the handoff transaction and offer policy, the source and
destination orchestration (`HandoffSource`, `HandoffDestination`), and the per-connection authority
check (`ConnectionAuthority`). The host supplies the carrier, payload sealing, record decoding,
durable persistence and the operator who approves requests.

## Usage

```typescript
import type { IPeerMessage, IConnectionPeer } from '@robota-sdk/agent-interface-session-mobility';
import {
  ConnectionAuthority,
  HandoffSource,
  HandoffDestination,
  isHandoffCommitted,
} from '@robota-sdk/agent-interface-session-mobility';
// Wires are agent-transport and agent-transport-webrtc; the reference CLI composes the host side.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, boundaries, and why peer messaging and handoff are one
  axis rather than two families.
