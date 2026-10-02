# @robota-sdk/agent-interface-session-mobility

Session mobility for the Robota SDK: what happens when a session is not confined to one process.
It covers two things on one axis — moving messages and files between live sessions (peer
messaging), and moving authority over a session to another machine (handoff) — plus the per-connection
authority another of the user's devices holds over a session.

Unlike the other `agent-interface-*` packages, this one is more than declarations. Next to the
contracts it ships the handoff state machine, the offer policy, the source and destination
orchestration (`HandoffSource`, `HandoffDestination`) and the per-connection authority check
(`ConnectionAuthority`). It does no I/O itself: the host supplies the carrier, the payload sealing,
record decoding and durable persistence, and it asks the operator whenever a request needs a yes.

## Installation

```bash
npm install @robota-sdk/agent-interface-session-mobility
```

## Usage

Construct one `ConnectionAuthority` per connection from what admission established about the
peer, and ask it before acting on a request. The carrier calls `authority.close()` when that
connection ends, including replacement or revocation; a new connection gets a new authority:

```ts
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import {
  ConnectionAuthority,
  type IConnectionPeer,
  type IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

declare const session: IInteractiveSession; // the session this connection reaches
declare function askOperator(question: string): Promise<boolean>; // your UI: true only on an explicit yes

const peer: IConnectionPeer = {
  deviceId: 'laptop',
  sessionId: 'peer-session-id',
  locality: 'another-host',
  capabilities: ['delegate', 'message'],
};
const approver: IOperatorApprover = {
  approve: (request) =>
    askOperator(`Allow ${request.capability} from ${request.deviceId ?? 'a peer'}?`),
};
const authority = new ConnectionAuthority(peer, approver);

await authority.authorize('message'); // { allowed: true }: a message needs no approval
await authority.authorize('drive'); // { allowed: false, reason: 'not-granted' }

const decision = await authority.authorizeDelegation({ requestId: 'r-1', task: 'Run the tests' });
if (decision.allowed) {
  // A peer turn under this session's ordinary permissions, answered to the sender.
  await session.submit(decision.turn.input, undefined, undefined, decision.turn.options);
}
```

Messages and presence need no approval. Delegating a task, sending a file and handing off a
session ask the operator for every request; observing and driving ask once per connection. With no
approver, those capabilities are refused. Closing cancels outstanding questions and denies cached
approvals as well as messaging. The admitted capability set is copied at construction; changing
the input object cannot widen it. A supplied abort signal is rechecked when sharing cached approval.

## What it provides

| Area                  | Exports                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peer messaging        | `IPeerMessage`, `IPeerMessageAck`, `IPeerMessageIngress`, `ISessionPeerMessagingPort`, `IPeerAdmission`, `TPeerTrust`, `TPeerDeliveryState`; predicates `isSameEnvironmentPeer`, `isTerminalPeerDelivery` |
| Device mesh admission | `IMeshAdmission`, `TMeshCapability`, `TPeerReach`                                                                                                                                                         |
| Connection authority  | `ConnectionAuthority`, `capabilityApproval`, `IConnectionPeer`, `IOperatorApprover`, `TCapabilityDecision`, `IDelegationRequest`, `TDelegationDecision`                                                   |
| File transfer         | `IFileOffer`, `IFileFrameChannel`                                                                                                                                                                         |
| Handoff contracts     | `IHandoffManifest`, `IHandoffPayload`, `IHandoffCommitAck`, `IHandoffOutcome`, `THandoffPhase`, `THandoffRefusal`; predicates `isHandoffCommitted`, `sourceRetainsAuthority`                              |
| Handoff transaction   | `beginHandoff`, `advanceHandoff`, `commitHandoff`, `handoffOutcome`, `sourceStillOwns`                                                                                                                    |
| Handoff offer         | `assessHandoffReadiness`, `prepareHandoffOffer` — refuse an offer while model or tool work is in flight, and build the manifest                                                                           |
| Handoff orchestration | `HandoffSource` (offer, transfer, apply the acknowledgement), `HandoffDestination` (receive, verify, commit), and the host ports `IHandoffComposition`, `IHandoffCarrier`                                 |

The source keeps authority until it holds an acknowledgement that the destination has written the
session durably; losing the connection before that leaves the source in charge. Provider
credentials never travel: the destination resolves its own at commit. A received file or delegated
task carries no authority, and a peer's driver id is for attribution only.

## Where it sits

- Depends on `@robota-sdk/agent-core` and `@robota-sdk/agent-interface-session`. No other package
  in the interface family depends on it.
- `@robota-sdk/agent-framework` admits incoming peer messages into a session.
- `@robota-sdk/agent-transport` implements the peer-message ledger, handoff payload sealing and
  chunking, and file transfer; `@robota-sdk/agent-transport-webrtc` runs the device mesh, with a
  `ConnectionAuthority` per connection.
- The reference CLI, `@robota-sdk/agent-cli`, composes handoff, remote control and device
  messaging from these pieces and supplies the operator approval.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract, the boundaries, and the design decisions behind
  handoff authority and peer admission.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
