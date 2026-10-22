---
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-cli': patch
---

Show a finished MCP tool call's app in an opaque frame with a source-bound JSON-RPC bridge. App callbacks use the session's view authority and permission prompt. Session changes and frame disposal reject pending local requests.

Hosts can provide a sandbox URL through `SessionSurface`. The web GUI serves a separate sandbox document with content restrictions and `Connection-Allowlist` enforcement. App execution requires Chromium 158 or newer and native network isolation; other browsers and hosts without the response policy show an unavailable message and retain the text result. A surface without a sandbox URL never reads the app document.
