---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-tui': patch
---

**ARCH-011: `ITransportAdapter.start()` now says which of its two meanings it has.**

The contract said only `start(): Promise<void>`, and two readings coexisted. Four transports bound a
port and returned; `headless` ran the entire prompt inside `start()` and `tui` blocked for the life of
the UI. `TransportRegistry.startAll` awaited each in turn, so registering either of those first meant
**every transport behind it never started** — no crash, no error, simply never reached.

`start()` resolves once the transport is SERVING. A transport whose whole job happens inside `start()`
declares the new optional `runsToCompletion: true`, and the registry starts it without awaiting:

```ts
const transport: ITransportAdapter = {
  name: 'my-runner',
  runsToCompletion: true, // start() does not return while this is alive
  attach(session) {
    /* … */
  },
  async start() {
    await this.runEverything();
  },
  async stop() {},
};
```

`TransportRegistry` gains `waitForCompletion()`, which settles when every run-to-completion transport
has finished and rejects with the first failure. The promise is kept rather than dropped, because a
transport whose entire job is inside `start()` is exactly the one whose failure matters.

Existing transports need no change: absence of `runsToCompletion` means the ordinary "resolves once
serving", which is what four of the six already did.
