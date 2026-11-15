---
'@robota-sdk/agent-mcp': patch
---

A sign-in takes an optional `clientMetadataUrl`: the address of a client metadata document the host publishes. When the authorization server accepts such documents and the document names this client and lists the sign-in's redirect address, its address is the client id and nothing is registered; otherwise the client registers dynamically as before, now saying whether it is a native or a web application, or the sign-in is refused with `client-metadata-unusable` (a document the server would take but this sign-in cannot rely on) or `client-metadata-url-invalid` (an address that is not `https` with a path).
