---
'@robota-sdk/agent-remote-client': minor
---

CORE-046: remote streaming works — a served route, one spelling, and the server owns assembly

`RemoteExecutor.executeChatStream` is back, and this time a server serves what it posts to. CORE-044
had removed it: the client posted to `${baseUrl}/stream`, a sibling module named `/chat/stream`, and
no server served either — so every remote streaming call was a 404 dressed as a capability, invisible
because the client's tests drove a mocked `fetch`. It could not simply be reconnected, because it
yielded RAW provider chunks and depended on a fragment assembler that CORE-042 deleted.

- **Transport: SSE**, on `POST /api/v1/remote/chat/stream` — one spelling, in the route table, in
  the client, and in both SPECs. Frames are `delta`, `message`, `done` and `error`; `error` is its
  own frame so a client cannot mistake a failed stream for a finished one, and a stream that ends
  without a terminal message throws rather than returning a truncated turn as an answer.
- **The server assembles.** It calls `provider.chat(messages, { onTextDelta })` — already every
  provider's contract — so the wire carries text deltas plus one terminal assembled message and
  tool-call fragments never cross it. The client re-implements no accumulator.
- `executeChatStream` yields ONE assembled message and hands every delta to the caller's
  `onTextDelta`: `IExecutor.executeChatStream` yields `TUniversalMessage`, and a partial message is
  not one.
- Cancellation is symmetric — aborting closes the socket, and the handler aborts the provider call.

The three-spellings state survived because no single place could compare them: the server is a
composition root forbidden from depending on a remote client. A harness scan now reads both literals
from source and fails when they disagree.
