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
import type { Duplex } from 'node:stream';
import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { serveRuntimeLink } from '@robota-sdk/agent-transport/link';
import type { IAdmittedRuntimeLink, IRuntimeLinkPorts } from '@robota-sdk/agent-transport/link';

declare const socket: Duplex; // the connection the control endpoint routed here
declare const runtimeId: string; // this runtime start, as its registration names it
declare const generation: string;
declare const rest: Uint8Array; // the bytes that arrived after the request line
declare const runtimeCustody: { portsFor(link: IAdmittedRuntimeLink): IRuntimeLinkPorts };

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
import type { Duplex } from 'node:stream';
import type { IOwnerHandover, SpawnerKey } from '@robota-sdk/agent-keyring';
import { openOwnerLink, openSpawnerLink } from '@robota-sdk/agent-transport/link';

declare const socket: Duplex; // a connection to the runtime's control endpoint
declare const otherSocket: Duplex; // another one, for the owner
declare const spawnerKey: SpawnerKey; // from the spawner exchange with the runtime
declare const instancePublicKey: Uint8Array; // the instance key that exchange carried
declare const handover: IOwnerHandover; // from openOwnerHandover

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

| Export                                                                     | Description                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `serveRuntimeLink`                                                         | The runtime's end of one link, after the control endpoint routed the request line; `IRuntimeLinkDeps` carries `identity`, `binding`, `rest`, `admit` and the two timeouts                        |
| `openSpawnerLink`, `openOwnerLink`                                         | The client's end, by the spawner key or by the owner handover; `IOpenRuntimeLinkOptions` adds `timeoutMs` and `expectedBinding`, the runtime start the handshake must prove                      |
| `openSelectedSpawnerLink`, `openSelectedOwnerLink`                         | The same, on a stream a trusted carrier opens for one selected runtime registration; the link is refused unless it proves exactly that registration                                              |
| `IRuntimeLinkClient`, `IOwnerRuntimeLinkClient`, `ILinkSessionChannel`     | One open link as its client holds it: standing, binding, custody, trust-root install, lock, the session question, control requests and the session protocol; the owner client alone can `unlock` |
| `IAdmittedRuntimeLink`, `IRuntimeLinkPorts`                                | One admitted link as the runtime holds it, and the desk, session and session-sink ports `admit` returns for it                                                                                   |
| `LINK_REQUEST_LINE`, `LINK_PROTOCOL`, `isLinkRequest`                      | The request line that opens a link, its protocol version, and the strict check of a parsed line                                                                                                  |
| `IOwnerLinkDesk`, `IOwnerLinkSessions`, `ILinkSessionSink`                 | The runtime's ports for one admitted link                                                                                                                                                        |
| `OwnerRequestRefusedError`                                                 | A refusal the runtime decided, with its code; what a desk throws to refuse                                                                                                                       |
| `OwnerLinkClosedError`                                                     | The link closed, or never opened                                                                                                                                                                 |
| `answerSpawnerPair`, `SPAWNER_PAIR_FD`, `ISpawnerPairIo`                   | The runtime's end of the one-shot spawner exchange: synchronously reads the spawner's first message from the inherited descriptor (4 by default), answers with the identity and closes it        |
| `completeSpawnerPair`, `ICompleteSpawnerPairOptions`, `ISpawnerPairResult` | The spawner's end: writes first, reads the answer, closes its end and returns the spawner key and the runtime's instance public key                                                              |
| `SpawnerPairError`                                                         | The exchange could not be carried out                                                                                                                                                            |
| `DEFAULT_HANDSHAKE_TIMEOUT_MS`, `DEFAULT_CLOSE_FLUSH_TIMEOUT_MS`           | The runtime's bound on a handshake and on a client taking its last queued frames after the runtime ended the link                                                                                |
| `DEFAULT_OPEN_TIMEOUT_MS`, `DEFAULT_SPAWNER_PAIR_TIMEOUT_MS`               | A client's bound on a runtime admitting it, and a spawner's bound on a runtime answering the exchange                                                                                            |

See [`docs/SPEC.md`](./SPEC.md) for the contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../../LICENSE) or a [commercial license](../../../COMMERCIAL.md). See [LICENSING.md](../../../LICENSING.md).
