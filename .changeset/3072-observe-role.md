---
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-cli': patch
---

The session protocol gains a read-only `observe` role.

- `createSessionMessageHandler({ role: 'observe' })` follows the session's conversation, streaming,
  tool, background, usage and workspace events and answers reads of this session. The default role
  stays `drive`, which is unchanged.
- An observer never subscribes to `permission_request` or `ask_request`. A session with only observers
  attached therefore still denies a permission and cancels a question at once instead of waiting for a
  surface that may not answer. Observers still see `prompt_resolved`.
- An observer cannot submit, run commands, abort, cancel the queue, control background tasks, answer
  prompts, or read personal or other sessions' usage reports. Each such message is answered with a
  `protocol_error` and changes nothing. Only an explicit list of reads is accepted, so a message type
  added later is refused to observers until it is classified.
- `ATTACHED_SURFACE_MAX_PENDING_BYTES` (1 MiB) is the backpressure budget a carrier passes to
  `createOutboundDelivery` for a terminal attached on the same host. A reader that falls that far
  behind is cut off and reported to the carrier, and other surfaces keep streaming. No carrier uses it
  yet.
- `agent-cli`: a supervised session's control endpoint no longer includes its generation in a
  refusal to a caller that did not present it.
