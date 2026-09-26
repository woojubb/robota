---
'@robota-sdk/agent-core': patch
---

A `run()` or `runStream()` whose signal is already aborted when its turn comes now fails as an abort:
`name === 'AbortError'`, so `isAbortFailure(err)` holds without the signal. The signal's own reason is
thrown when it already is an `AbortError` (the default `controller.abort()`); any other reason,
including an error that only wraps an abort, becomes the `cause` of an abort error whose message says
`Run aborted before it started`, or `Run aborted while queued behind another run on this instance`
only when the run actually waited behind another. It still never reaches the provider or the history.
Previously it was a plain `Error` that always claimed the run had been queued.
