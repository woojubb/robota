---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-transport-mcp': patch
---

`--serve --http-port` can serve the agent HTTP API as an OAuth resource server: with `--http-public-url`, `--oauth-issuer`, `--oauth-scopes` and `--oauth-allowed-subjects` (plus optional `--http-host` and `--trusted-proxy`) it may bind a non-loopback address and admits access tokens through the same shared resource-server gate as `mcp serve`. Without them it stays loopback with the `PRODUCT_HTTP_TOKEN` bearer.

The refusal answer shared by both resource-server carriers (503 for unavailable issuer keys, uncounted; counted challenge otherwise) is now `refuseAccessToken` in `@robota-sdk/agent-transport/node`.
