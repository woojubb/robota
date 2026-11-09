# @robota-sdk/agent-transport/link

The owner link carrier for the Robota SDK. It runs the owner link of `@robota-sdk/agent-keyring`
over a local byte stream, such as a supervised runtime's control socket, so a client reaches a
runtime only by proof: the process that started the runtime by the key it derived with it, and the
owner by the attach key behind the passphrase. Any other program that connects, takes the socket
over or answers in the runtime's place gets nothing past the client's first message.

Inside the link it carries the unchanged session protocol of `@robota-sdk/agent-transport` and the
owner vocabulary: installing the runtime's trust root, a read grant that unlocks the runtime, lock,
the question asked before opening a session not verified as the owner's, and the runtime's existing
control commands.

## Installation

```bash
npm install @robota-sdk/agent-transport @robota-sdk/agent-keyring
```

Requires Node.js 22.12 or later; it also runs on Bun. `@robota-sdk/agent-keyring` is an optional peer
dependency of the package, installed for this subpath only.

## Usage

The runtime's control endpoint routes the request line `{"command":"link","protocol":1}` to
`serveRuntimeLink`, with the bytes that followed it:

```ts
import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { serveRuntimeLink } from '@robota-sdk/agent-transport/link';

const identity = createRuntimeIdentity(); // answers the spawner exchange at start
serveRuntimeLink(socket, {
  identity,
  binding: { runtimeId, generation },
  rest,
  admit: (link) => runtimeCustody.portsFor(link), // decides what link.standing may do
});
```

The spawner certifies the runtime it started; the owner then unlocks it:

```ts
import { openOwnerLink, openSpawnerLink } from '@robota-sdk/agent-transport/link';

const spawner = await openSpawnerLink(socket, spawnerKey, instancePublicKey);
await spawner.installTrustRoot(handover.certify(spawner.instancePublicKey, spawner.binding));
spawner.close();
spawnerKey.wipe();

const owner = await openOwnerLink(otherSocket, handover);
await owner.unlock(); // 'verified' or 'mismatch'
owner.session.send({ type: 'submit', prompt: 'hello' });
```

Opening rejects with the keyring's `LinkRefusedError` when the runtime is not the one it must be
(`reason` says which check failed, for example `certificate-mismatch` for a runtime another keyring
certified), and with `OwnerLinkClosedError` when the runtime closes the link.
Sending a session message also throws `OwnerLinkClosedError` and closes the link when the outgoing
stream cannot accept another frame within its bounded buffer. A successful send accepts the frame
for delivery; it does not mean the runtime has processed the message.

## API

| Export                                 | Description                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `serveRuntimeLink`                     | The runtime's end of one link, after the control endpoint routed the request line |
| `openSpawnerLink`, `openOwnerLink`     | The client's end, by the spawner key or by the owner handover                     |
| `LINK_REQUEST_LINE`, `isLinkRequest`   | The request line that opens a link, and its strict check                          |
| `IOwnerLinkDesk`, `IOwnerLinkSessions` | The runtime's ports for one admitted link                                         |
| `OwnerRequestRefusedError`             | A refusal the runtime decided, with its code; what a desk throws to refuse        |
| `OwnerLinkClosedError`                 | The link closed, or never opened                                                  |

See [`docs/SPEC.md`](./SPEC.md) for the contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../../LICENSE) or a [commercial license](../../../COMMERCIAL.md). See [LICENSING.md](../../../LICENSING.md).
