---
'@robota-sdk/agent-transport': minor
'@robota-sdk/agent-framework': patch
---

The transport carriers are now subpaths of `@robota-sdk/agent-transport`: `ws`, `http`, `mcp`, `acp`, `webrtc` and `link`, next to the existing root, `client` and `node`. Import the subpath of the carrier you use (`@robota-sdk/agent-transport/ws`); a bundle that imports one carrier contains no other carrier, and the root and `client` entries still run in the browser. Every carrier except `http` is Node only and maps `browser: null`. The carrier libraries (`ws`, `hono`, `@modelcontextprotocol/server` and `@modelcontextprotocol/node`, `@agentclientprotocol/sdk` and `zod`, `bittorrent-dht`, `multicast-dns`, `nostr-tools`, `node-datachannel`) and the `@robota-sdk/agent-remote-pairing` and `@robota-sdk/agent-keyring` packages that `webrtc` and `link` build on are optional peer dependencies: install the ones for the carriers you import. The exported names and signatures are unchanged. `@robota-sdk/agent-transport-ws`, `-http`, `-mcp`, `-acp`, `-webrtc` and `-link` no longer receive releases.
