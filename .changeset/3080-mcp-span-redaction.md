---
'@robota-sdk/agent-mcp': minor
---

MCP definition projections now show stdio command, args and cwd readable instead of `[REDACTED]`, with only their secret stretches masked: values expanded from credential-shaped variables (`secret:VAR`) and literals shaped like a credential (`secret:literal`) — the value after a credential-named flag, known token formats (`sk-`, `ghp_`, `github_pat_`, `glpat-`, `xoxb-`, `AKIA…`, `AIza…`, JWTs, `Bearer …`) and long high-entropy runs, while commit SHAs and sha256 digests stay visible. Credential-named header-form values (`X-API-Key: …`, any `Authorization` scheme), JSON or dict entries (`{"apiKey":"…"}`) and connection-string entries (`;Password=…`) are masked too. URLs additionally mask a userinfo password and credential-named query or fragment values. `activationEndpoint` applies the same masking. `env` and `headers` values stay fully redacted, and the definition fingerprint is unchanged — the shape detector is display-only.

New exports: `looksLikeCredential`, `maskCredentials`, `displayValue`, `displayArgs`.
