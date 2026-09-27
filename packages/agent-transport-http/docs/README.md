# @robota-sdk/agent-transport-http

The HTTP transport for the Robota SDK, built on Hono. It exposes a running agent session as HTTP routes:
submit a prompt and stream the response as Server-Sent Events, run a command, abort, and read the
conversation, context and execution state. Every request is admitted by a bearer token unless the host
explicitly opens the routes with a written reason.

The package returns a Hono app or router and does not bind a network listener. Admission decisions come
from `@robota-sdk/agent-transport/node`, shared with the other transports.

## Documents

- [SPEC.md](./SPEC.md) — package contract, invariants and error handling.
- [README](../README.md) — installation, usage and the route list.
