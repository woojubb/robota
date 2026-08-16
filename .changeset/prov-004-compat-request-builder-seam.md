---
'@robota-sdk/agent-provider-openai-compatible': patch
---

**PROV-004: the OpenAI-compatible siblings build their request through one seam.**

`deepseek`, `qwen` and `gemma` each carried a private `buildRequestParams` with the same body —
model resolution, the same "Model is required" error, and the same `temperature` / `max_tokens` /
`tools` / `tool_choice` spread. Three copies meant a field added to the request reached the model on
whichever provider happened to be edited, and none of the others.

That is not hypothetical: `IChatOptions.responseFormat` has been declared since CORE-015 and is
mapped by `agent-provider-openai`, while this package has never referenced it once. PROV-004
classifies that as a contract violation, and CORE-043 is the root item for what the runtime must know
before the field can be sent honestly.

The three copies are now one `buildOpenAICompatibleRequestParams` in `./shared`. This change is
behaviour-preserving — the request each provider emits is byte-identical, and the package's 101
existing tests pass unchanged — so it fixes nothing on its own. What it changes is the cost of the
fix: whatever CORE-043 decides is now one edit in one file rather than three that can disagree.

Two asymmetries between the siblings are preserved rather than tidied away, because collapsing them
would be a behaviour change wearing a refactor's clothes: `validateTools` stays at each call site
(gemma does not call it), and deepseek keeps spreading its own `thinking` / `reasoning_effort` onto
the shared result. The shared return type omits `reasoning_effort` to say so in the type system —
deepseek narrows that field to its own vocabulary.
