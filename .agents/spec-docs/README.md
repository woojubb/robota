# Spec Documents

Spec documents track all planned and in-progress work items. Each document moves through lifecycle
folders as it advances through the gate pipeline.

## Lifecycle Folders

| Folder      | `status` value              | Gate that moves into this folder                |
| ----------- | --------------------------- | ----------------------------------------------- |
| `draft/`    | `draft`                     | Created by `backlog-writer`                     |
| `backlog/`  | `review-ready`              | GATE-WRITE PASS                                 |
| `todo/`     | `approved`                  | GATE-APPROVAL PASS                              |
| `active/`   | `in-progress` · `verifying` | GATE-IMPLEMENT PASS (stays through GATE-VERIFY) |
| `done/`     | `done`                      | GATE-COMPLETE PASS                              |
| `rejected/` | `rejected`                  | Rejection action (any stage)                    |

## Frontmatter Schema

Every spec document begins with:

```yaml
---
status: draft
type: INFRA
tags: [cli]
---
```

**`status`:** `draft` · `review-ready` · `approved` · `in-progress` · `verifying` · `done` · `rejected`

**`type`:** `SCREEN` · `API` · `FLOW` · `BEHAVIOR` · `DATA` · `RULE` · `AGREEMENT` · `INFRA` · `PERF` · `SECURITY` · `OBSERVABILITY`

**`tags`:** environment (`web` · `mobile-web` · `desktop` · `cli` · `ios` · `android`), protocol (`rest` · `websocket` · `mcp` · `json-schema` · `typescript`), NFR (`i18n` · `a11y` · `async` · `streaming` · `realtime` · `auth`)

## Type Prefix Taxonomy

| Prefix          | Nature                                           |
| --------------- | ------------------------------------------------ |
| `SCREEN`        | UI / visual output (web, terminal, mobile)       |
| `API`           | HTTP / WebSocket / RPC / MCP interface           |
| `FLOW`          | Multi-step user/agent interaction sequence       |
| `BEHAVIOR`      | System-internal execution, state transitions     |
| `DATA`          | Schema, type contract, data model                |
| `RULE`          | Business logic, validation, constraints          |
| `AGREEMENT`     | Cross-system / cross-team boundary contract      |
| `INFRA`         | Build, deploy, CI/CD                             |
| `PERF`          | Performance contract (latency, throughput, cost) |
| `SECURITY`      | Auth, threat boundary, data protection           |
| `OBSERVABILITY` | Logs, metrics, traces, event emission contract   |

See [`backlog-writer`](../skills/backlog-writer/SKILL.md) for the full taxonomy table with SDLC
basis, tag derivation, and test strategy mapping.

## File Naming

`<NAMESPACE>-<NNN>-<kebab-slug>.md` — e.g., `CLI-035-path-traversal-protection.md`,
`PM-025-cost-accuracy.md`, `WORKFLOW-001-absorb-dag.md`.

The filename **`<NAMESPACE>`** is an initiative / domain label (`CLI`, `PM`, `PRESET`, `HARNESS`,
`SITE`, `WORKFLOW`, …) — it groups related work. It is **orthogonal to the `type` frontmatter**, which
is the SDLC classification (one of the 11 below). The two answer different questions: the namespace says
_which initiative_, `type` says _which SDLC category_. So `CLI-035` may be `type: SECURITY` and
`CLI-042` may be `type: PERF`. A namespace MAY coincide with a type name (`RULE-001` is `type: RULE`),
but that is not required. `<NNN>` should be unique within its namespace.

Frontmatter validity (`status`, `type` ∈ 11, `tags` present) is enforced by
`scripts/harness/check-spec-doc-frontmatter.mjs` (`RULE-011`).

## Process

Use the gate pipeline skills to advance documents:

- [`backlog-pipeline`](../skills/backlog-pipeline/SKILL.md) — orchestrator (start here)
- [`backlog-writer`](../skills/backlog-writer/SKILL.md) — content authoring
- [`backlog-gate-guard`](../skills/backlog-gate-guard/SKILL.md) — gate validation

See [spec-workflow rules](../rules/spec-workflow.md) for the HARD GATE policy.
