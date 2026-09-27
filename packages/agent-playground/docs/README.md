# Playground Docs Index

`@robota-sdk/agent-playground` (internal) owns the Robota Playground UI: the React components for
configuring an agent, adding tools and skills, chatting with it, and visualizing its execution in the
browser. Agent execution happens on a remote agent server through `@robota-sdk/agent-remote-client`;
the playground deliberately depends on no local session stack (`agent-framework`, `agent-session`,
`agent-executor`). `apps/agent-web` hosts it.

## Documents

- [SPEC.md](./SPEC.md) — playground scope, dependency boundary, and integration contract.
- [Package README](../README.md) — what the playground offers and how a page embeds it.
