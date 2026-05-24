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

`<TYPE-PREFIX>-<NNN>-<kebab-slug>.md` — e.g., `BEHAVIOR-001-session-abort.md`,
`API-003-playground-catalog.md`.

Each number is unique within its prefix group. The prefix comes from the `type` frontmatter field.

## Process

Use the gate pipeline skills to advance documents:

- [`backlog-pipeline`](../skills/backlog-pipeline/SKILL.md) — orchestrator (start here)
- [`backlog-writer`](../skills/backlog-writer/SKILL.md) — content authoring
- [`backlog-gate-guard`](../skills/backlog-gate-guard/SKILL.md) — gate validation

See [spec-workflow rules](../rules/spec-workflow.md) for the HARD GATE policy.
