---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-provider-gemini': patch
---

Provider adapters now throw the specific typed failure a vendor response describes, instead of a
generic `ProviderError` carrying only its status. A 401/403 (or a vendor-specific authentication type)
becomes an `AuthenticationError`; a response naming an unavailable model — by code or, when the vendor
gives neither (Anthropic's and Gemini's real bodies carry no distinguishing code), by its message —
becomes a `ModelNotAvailableError`, whose `model` is now optional since a bare HTTP status does not
always name one; a transport failure becomes a `NetworkError`, which now also carries the provider
name. A 429's `retry-after` header (a delta or an HTTP-date) is read into `RateLimitError.retryAfter`
when the vendor sends one.

Vendor error text is scrubbed of anything that reads like a credential — an `Authorization`/`Bearer`
value, an API key in a header, query string or JSON body, a bare `sk-`/`AIza…` token — before it is
kept on any of these typed errors, so a misconfigured self-hosted gateway that echoes a request back
can no longer leak one into a message or a "Details" disclosure. The new `scrubSecrets` export applies
the same scrubbing to arbitrary text.
