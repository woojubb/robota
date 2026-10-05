---
'@robota-sdk/agent-cli': minor
---

`--serve --http-port` can serve the agent HTTP API as an OAuth resource server: with `--http-public-url`, `--oauth-issuer`, `--oauth-scopes` and `--oauth-allowed-subjects` (plus optional `--http-host` and `--trusted-proxy`) it may bind a non-loopback address and admits access tokens through the same shared resource-server gate as `mcp serve`. Without them it stays loopback with the `PRODUCT_HTTP_TOKEN` bearer.
