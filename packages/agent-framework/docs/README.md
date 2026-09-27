# agent-framework Docs

`@robota-sdk/agent-framework` is the assembly layer of the Robota SDK. It owns `InteractiveSession`,
`createQuery()` and `createAgentRuntime()`, and the pieces they compose: workspace trust and project
access, settings and context loading (`AGENTS.md`/`CLAUDE.md`), prompt `@file` references, command
infrastructure and skills, permission prompting, edit checkpoints, memory, subagent assembly,
background job orchestration and bundle plugins.

It does not own provider implementations, the session run loop (`@robota-sdk/agent-session`), tool
implementations (`@robota-sdk/agent-tools`), permission evaluation or hook execution
(`@robota-sdk/agent-core`), or any UI.

## Documents

- [Package README](../README.md) — entry points, options, events and usage examples.
- [SPEC.md](./SPEC.md) — package contract, ownership boundaries and design decisions.
- [design/frontmatter-decoder.md](./design/frontmatter-decoder.md) — how skill, bundle-skill and
  agent definition frontmatter is decoded and validated.
