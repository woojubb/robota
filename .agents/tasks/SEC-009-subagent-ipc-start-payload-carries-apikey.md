---
title: 'SEC-009: the subagent IPC start payload carries apiKey'
status: in-progress
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1786
---

# SEC-009: the subagent IPC start payload carries apiKey

> Renumbered from SEC-008, which was already taken by
> `completed/SEC-008-transport-admission-is-documentation-not-code.md`. That collision mattered:
> `resolveRootItems` scans `completed/`, so a containment note citing SEC-008 would have resolved
> **silently to an unrelated closed item** — strictly worse than an unfiled ID, which fails loudly.

## Problem

Surfaced by a `prior-art-researcher` sweep during ARCH-021, and filed separately because it is a
distinct security-posture change with its own blast radius.

`createProviderProfile` serializes `apiKey` into `ISubagentWorkerStartPayload`, because the child
builds its own provider. It therefore lands in IPC logs and transcripts.

Every comparable product hands credentials to a locally spawned child through the **environment**
instead — Claude Code (`claude mcp add --env …`), the Claude Agent SDK (`env: { API_KEY: … }`), and
OpenAI Codex CLI (`--env KEY=VALUE`, `$CODEX_HOME`). MCP's Security Best Practices additionally
forbids token passthrough outright: a server "MUST NOT accept any tokens that were not explicitly
issued for" it.

The runner already has an `env` option, so the mechanism exists.

## Direction

Move the credential out of the start payload and onto the child's `env`.

Upgrade path if credential confinement is ever required: MCP-style sampling — proxy inference and
hold the key in the parent — at the documented cost that exact model selection is lost and hints
become advisory. That is why it is **not** the answer today: ARCH-021's whole point is that the
subagent runs on the product's custom provider definition.

## Blockers

- None.

## Result

Pending.
