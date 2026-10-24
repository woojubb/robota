---
'@robota-sdk/agent-provider-openai': patch
---

Add a constructor and profile `parallelToolCalls` boolean that forwards the native generation
policy on Chat Completions and Responses, preserving explicit false across streaming and
non-streaming calls. Omission preserves existing behavior. Reject malformed or unsupported
configurations before dispatch, retain the policy despite caller option mutation, and preserve
all returned calls and usage without claiming a call-count or execution-order guarantee.
