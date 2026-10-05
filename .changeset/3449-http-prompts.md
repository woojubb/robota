---
'@robota-sdk/agent-transport-http': minor
'@robota-sdk/agent-cli': patch
---

HTTP clients can now receive and answer permission and ask prompts. `POST /submit` with `receivePrompts: true` streams `permission_request`, `ask_request` and `prompt_resolved`. `GET /prompts` lists the prompts still open, so a client that attaches later can see them, and `POST /prompts/:id` answers one; an id that is not open returns 404, and an answer the session did not take returns 409. Clients that omit `receivePrompts` see no change. `IHttpTransportSession` now also requires `resolvePermission` and `resolveAsk`, which `InteractiveSession` already implements. The `--serve --http-port` API gains these routes as well.
