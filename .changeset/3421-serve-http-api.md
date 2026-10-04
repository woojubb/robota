---
'@robota-sdk/agent-cli': minor
---

`--serve --http-port <port>` also serves the agent HTTP API on `127.0.0.1:<port>`, so other
applications and services can submit a prompt and stream its result over SSE, run a slash command,
abort and read the conversation without a Robota client library. Requests are admitted by the
bearer in `PRODUCT_HTTP_TOKEN` (at least 32 characters), which the runtime removes from its
environment before any command runs; the API binds loopback only and is reached from elsewhere
through the operator's own proxy. `--http-port` keeps its `mcp serve` meaning.
