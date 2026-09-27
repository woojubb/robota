# Agent Server Docs Index

`@robota-sdk/agent-server` (internal, not published to npm) is an AI provider proxy with a Playground
WebSocket server. It keeps provider API keys server-side and backs the Playground UI hosted by
`apps/agent-web`. Its environment variables are listed in [`.env.example`](../.env.example); Playground
WebSocket authentication also needs `JWT_SECRET`, and is refused without it.

- [`SPEC.md`](./SPEC.md): scope, streaming and validation guarantees, secret handling, shutdown behavior.
- [`openapi.yaml`](../openapi.yaml): machine-readable HTTP route contract.
