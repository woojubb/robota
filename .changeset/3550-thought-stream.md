---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-transport-acp': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-openai-compatible': minor
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-ui-terminal': patch
---

**Reasoning text a provider streams now reaches the editor as an ACP `agent_thought_chunk`, through a new `thinking_delta` session event.**

`IChatOptions.onThinkingDelta` and `IRunOptions.onThinkingDelta` carry reasoning text from a provider
through the run, and `ISessionOptions.onThinkingDelta` hands it to the session's owner.
`InteractiveSession` emits it as `thinking_delta(delta)`, beside `text_delta`. The text is never part
of the reply: it is not appended to the conversation, not streamed through `onTextDelta`, and not in
the session log or the replay events. A reasoning delta counts as provider activity for the idle
timeout, so a model that is only thinking is not cut off. The existing `thinking(isThinking)` event is
unchanged and remains the busy indicator. Where a provider sends no reasoning text, nothing is emitted
and nothing new is switched on.

`@robota-sdk/agent-transport-acp` sends each non-empty `thinking_delta` to the editor as an
`agent_thought_chunk`, in order with the message chunks. A turn that streamed only thoughts still
shows its result text, because only reply text marks a turn as streamed. The WebSocket wire and the
terminal UI do not carry the new event in this change (`@robota-sdk/agent-transport` and
`@robota-sdk/agent-ui-terminal` classify it as non-surface).

Two providers already receive reasoning text and now report it. `@robota-sdk/agent-provider-openai`
passes `response.reasoning_summary_text.delta` events of a streamed Responses call to
`onThinkingDelta`; the API sends them only when the provider profile asks for a reasoning summary, and
no request option changed. `@robota-sdk/agent-provider-openai-compatible` reports the text of Gemma's
thought channel, which the provider already removed from the reply, as it streams across chunk
boundaries; the reply text is unchanged. No other provider reports reasoning, and Anthropic thinking is
not enabled.

The scripted test provider (`@robota-sdk/agent-core/testing`) accepts an optional `thinking` string on
a turn and delivers it through `onThinkingDelta` before the turn's text, and the scripted session
harness collects `thinking_delta`.
