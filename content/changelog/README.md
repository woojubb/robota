---
title: Changelog
description: What's new in Robota SDK — user-facing changes, new features, and bug fixes.
---

# Changelog

Highlights of user-facing changes, new features, and notable fixes in past releases. Every published
package also ships its own `CHANGELOG.md` with the complete record for each version — for example
[`@robota-sdk/agent-cli`](../../packages/agent-cli/CHANGELOG.md) and
[`@robota-sdk/agent-core`](../../packages/agent-core/CHANGELOG.md). The commit history is on
[GitHub](__PROJECT_REPOSITORY_URL__).

---

## 2026-11-10 — 3.0 to 3.3

### New features

**Read-only observer for a served session** (3.3.0) — `__PRODUCT_CLI_NAME__ --serve --observer-port <port>` opens a second
loopback listener with its own token (`__PRODUCT_ENV_PREFIX__OBSERVER_TOKEN`, at least 32 characters, different from the
driver and HTTP tokens). An observer reads the conversation and state; it cannot submit, answer prompts,
run commands or switch sessions, and its disconnect does not end the session. A secure runtime and a
hosted task worker refuse the flag.

**Secure conversations, opt-in** (3.2.0) — The desktop shell opens a certified runtime for secure
conversations, and `__PRODUCT_CLI_NAME__ secure setup`, `status`, `enable`, `disable`, `lock`, `verify` and
`change-passphrase` manage the keyring they are sealed to. Secure mode stays off until you enable it.

**Fork and daemon commands** (3.2.0) — Follow a running fork without stopping its parent, steer its job and
continue its record after it ends. `__PRODUCT_CLI_NAME__ daemon clear-start-lock` clears an abandoned daemon start lock.

### Fixes

- Edit checkpoints are serialized per session and claimed across processes, and a session that closes
  normally keeps its record claim until it is down (3.3.0).
- A secure runtime launch that fails after the runtime was proved returns only once that runtime is gone
  (3.2.2).
- The workspace root broker exits once the user-state directory it serves is removed or replaced
  (3.2.2).

### Breaking (SDK)

**Explicit project access** (3.0.0) — Project filesystem access is a host-issued authority, not an ambient
consequence of `cwd`. A caller that supplies no `projectAccess` runs Restricted: it gets no project
filesystem capability and does not load the project's instruction files or settings.

**Merged SDK packages** (3.2.2) — The CLI and the desktop app import providers, host primitives, transport
carriers, the default tool set, product assembly and the shared contracts from the subpaths of
`@robota-sdk/agent-provider`, `@robota-sdk/agent-os`, `@robota-sdk/agent-transport`,
`@robota-sdk/agent-tools`, `@robota-sdk/agent-product` and `@robota-sdk/agent-interface`. The command
line, the settings and the behavior are unchanged. The [migration guide](../guide/migration.md) lists the
import paths.

---

## 2026-07-06 — Beta 77–79

### New features

**`/workflows create` — natural-language workflow authoring** — The `/workflows` CLI
command can now author a workflow from a plain-English description. `__PRODUCT_CLI_NAME__` → `/workflows create
"fetch the issues, summarize each, then post a digest"` asks the active provider to design the
workflow, saves it as a reusable `.workflows/<name>.json` artifact (with any prompt-backed nodes
under `.workflows/nodes/`), and runs it immediately. At this release, `create` was model-invocable.
The [current CLI](../guide/cli.md#workflows-workflows) requires the user to invoke the command and
confirm the write. The command surface at this release was
`create "<desc>" [--input key=value] [--name <name>] | list | catalog | validate <file> | run <file>`
— `list` shows available workflow node kinds, `catalog` lists saved workflow files in `.workflows/`,
and `validate` / `run` operate on a workflow file.

### Internal

**Self-contained `agent-cli` bundle** — `@robota-sdk/agent-cli` publishes as a self-contained bundle:
the `@robota-sdk` code it uses, including the `/workflows` command, is bundled into `dist`, and the
published `dependencies` contain only third-party npm packages.

**Instant-node provider and persistence round-trip** — Instant (prompt-backed) workflow nodes resolve
their provider from a single source of truth and survive a symmetric save/load round-trip, so an
authored workflow reloads with the same provider wiring it was created with.

**Single-OTP publish** — The release/publish flow detects already-published versions per package
version and completes a multi-package publish with a single OTP entry instead of prompting repeatedly.

---

## 2026-06-14 — Beta 68–76

### New features

**`@robota-sdk/agent-session-analytics`** — A package that analyzes session logs to report timing
breakdowns (LLM wait vs. tool/code time, slow intervals). Session-log analysis lives in this dedicated
package instead of the `agent-cli` thin shell.

### Internal

Design-quality audit remediation (SSOT consolidation, package cohesion, error/observability hygiene)
and a round of harness/rules hardening. No runtime behavior change for existing apps.

---

## 2026-05-23 — Beta 67

### New features

**Plugin development guide and directory** — A new [Building Plugins](../guide/plugins.md) guide covers the full lifecycle for writing, testing, and publishing community plugins. The [Plugin Directory](../plugins/README.md) page lists official plugins with a process for submitting community plugins.

**`__PRODUCT_CLI_NAME__ init` — project initialization** — Running `__PRODUCT_CLI_NAME__ init` in any directory creates a starter `AGENTS.md` and `<project-state>/settings.json`. If a `.claude/` directory is detected, it offers to migrate Claude Code settings automatically.

**Local LLM support guide** — A dedicated [Local LLM Setup](../guide/local-llm.md) guide covers Ollama, LM Studio, and llama.cpp with per-model recommendations. No API key needed for any local inference server.

**Context warning banner** — The TUI now shows a yellow warning at 70% context usage and a red alert at 90%, with a prompt to run `/compact`.

**Improved `/compact` output** — Running `/compact` now reports how many messages were removed, the percentage reduction, and before/after context window usage.

**3-level permission memory** — The permission prompt now has a third option: "Allow always (this project)." Choosing it writes the tool pattern to `<project-state>/settings.local.json` so the permission persists across sessions in that project.

---

## 2026-05-10 — Beta 60–66

### New features

**`maxSameToolInputs` safety limit** — Set `maxSameToolInputs` on a `ConversationAgent` to automatically abort a run if the same tool is called with identical inputs more than N times. Prevents infinite retry loops.

### Fixes

**Session log correlation** — Tool calls in session logs now carry consistent correlation keys, making replay-grade reconstruction reliable.

---

## 2026-05-02 — Beta 59

See the [full release notes for Beta 59](../guide/release-2026-05-02.md) for a detailed breakdown of all changes in this release window, including:

- Subagent background jobs with transcripts, watchdogs, and command surfaces
- Provider composition: Qwen, Gemma, Gemini, Anthropic, OpenAI, and OpenAI-compatible in one config
- Session log events for replay-grade provenance
- Deterministic parallel `Agent` tool calls via `jobs`
- CI/deploy build reuse — single monorepo root build, no per-package rebuild loops

---

## Version history

| Version           | Date       | Notes                                                                       |
| ----------------- | ---------- | --------------------------------------------------------------------------- |
| 3.3.0             | 2026-11-10 | Read-only observer listener, serialized edit checkpoints                    |
| 3.2.0–3.2.2       | 2026-11-07 | Opt-in secure conversations, `daemon clear-start-lock`, merged SDK packages |
| 3.1.0–3.1.2       | 2026-11-07 | Unlock gate for secure conversations (off until enabled), Intel macOS fixes |
| 3.0.0–3.0.7       | 2026-10-30 | Explicit project access (workspace trust)                                   |
| 3.0.0-beta.80–106 | —          | See the [CLI changelog](../../packages/agent-cli/CHANGELOG.md)              |
| 3.0.0-beta.79     | 2026-07-06 | Instant-node provider and persistence round-trip, single-OTP publish        |
| 3.0.0-beta.77–78  | 2026-07-05 | `/workflows create` NL authoring, self-contained CLI bundle                 |
| 3.0.0-beta.68–76  | 2026-06-14 | `agent-session-analytics`, design-quality audit                             |
| 3.0.0-beta.67     | 2026-05-23 | Plugin guide, `__PRODUCT_CLI_NAME__ init`, local LLM guide, UX improvements |
| 3.0.0-beta.60–66  | 2026-05-10 | Safety limits, session log correlation                                      |
| 3.0.0-beta.59     | 2026-05-02 | Subagents, multi-provider, session replay, parallel agents                  |
| 3.0.0-beta.56–58  | 2026-05-01 | [See release notes](../guide/release-2026-05-02.md)                         |

---

## Stay updated

- Watch [GitHub releases](__PROJECT_REPOSITORY_URL__/releases) for tagged versions
- Subscribe to [npm](https://www.npmjs.com/package/@robota-sdk/agent-cli) for package updates
