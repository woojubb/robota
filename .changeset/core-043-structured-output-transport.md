---
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-core': patch
---

CORE-043: structured output now knows which transport can carry the schema before the first call

`run(input, { output })` asked every provider for `responseFormat: { type: 'json_schema' }`. A
provider whose surface cannot express that accepted the option and dropped it — and the schema was
stated in words only by the RETRY feedback turn, which runs on attempt two. So against such a
provider, attempt one carried nothing describing the required shape and could only succeed by luck:
the advertised three attempts were really two, and the first was spent discovering something the
capability table already knew.

A `(provider, model)` pair now resolves to a mechanism (`response_schema` / `json_object` / `none`)
and a provenance (`catalog` / `vendor-default` / `undeclared` / `unverified-endpoint`), and the
request is shaped to match at the one seam that holds both the resolved provider and the outgoing
messages. When the wire cannot carry the shape, the schema is stated in the prompt on the FIRST
attempt. Each structured request emits a `structured_output_transport` event reporting what the
request actually did.

- `IAIProvider.endpointIsVendorDefault?()` — a provider configured with a custom `baseURL` reports
  it, so the runtime stops claiming enforcement a gateway may not provide. Separate from
  `capabilityTable?()` on purpose: `@robota-sdk/agent-provider-openai` declares no table (nobody has
  verified one) and must still be able to answer.
- DeepSeek's capability table declared `json_schema`; DeepSeek guarantees the response PARSES but
  takes no schema parameter. Corrected to `json_object`.
- A provider that declares nothing is still sent the request unchanged — silence is not a denial.
