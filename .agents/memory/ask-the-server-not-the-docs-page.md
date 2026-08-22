---
name: ask-the-server-not-the-docs-page
description: "A vendor's prose docs page and its machine-readable discovery document disagreed in both directions; only calling the server settled it"
metadata:
  node_type: memory
  type: reference
  originSessionId: 22469e82-14ef-4e23-9aea-9e5bd3295700
---

Researching Vercel AI Gateway (issue #1930), the prose docs page and the OIDC discovery document
gave OPPOSITE wrong answers about the same capability:

- `/docs/sign-in-with-vercel/authorization-server-api` listed five endpoints and said `grant_type` is
  "Either `authorization_code` or `refresh_token`" → would have concluded **no device flow exists**.
- `/.well-known/openid-configuration` advertised `device_code` AND an RFC 7591
  `registration_endpoint` → would have concluded **device flow is available to third parties**.

The server settled it: dynamic registration returns **201 without authentication**, and
`device_code` is **silently dropped** from the granted `grant_types`. The failure surfaces only
later, as `401 unauthorized_client` at the device endpoint.

**The check that mattered: compare the REQUESTED field against the GRANTED one in the response.**
A 201 reads as success; the diff between what was asked for and what came back is where the refusal
actually lives.

Two more traps from the same session:

- **An empty response is not "unsupported".** `json_schema` structured output returned empty
  `content` at `max_tokens: 200` because reasoning tokens consumed the budget; at 2000 it parsed.
- **The served model id can differ from the requested one** — `openai/gpt-5-fast` → `openai/gpt-5`
  with no fallback configured. Key on `response.model`, never on the request.

Session-memory mirror of the same fact. In-repo record: `.agents/tasks/completed/PROV-011-vercel-ai-gateway-researched-and-declined.md`.
Related: [[one-table-two-regex-engines]] — the same shape, two readers of one source disagreeing.
