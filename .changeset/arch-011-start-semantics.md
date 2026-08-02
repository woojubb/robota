---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-tui': minor
'@robota-sdk/agent-framework': minor
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

`ITransportRegistryView` and `TransportRegistry` gain `waitForCompletion()`, which settles when every
run-to-completion transport has finished and rejects with the first failure to occur — **any custom
implementation of `ITransportRegistryView` must add it**. `IRuntimeHostHandle` (`@robota-sdk/agent-framework`) gains the
same method, so the caller that owns the process-lifetime wait can race it — **any consumer
implementing or mocking that handle must add it**.

The registry attaches the rejection handler when it starts such a transport rather than leaving it to
whoever calls `waitForCompletion`: holding a promise is not handling it, and a rejection in the gap
aborts the process. `stopAll()` abandons in-flight run-to-completion transports, since `stop()` is a
no-op for both of them.

Existing transports need no change: absence of `runsToCompletion` means the ordinary "resolves once
serving", which is what four of the six already did.
