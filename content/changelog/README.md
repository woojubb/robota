---
title: Changelog
description: What's new in Robota SDK — user-facing changes, new features, and bug fixes.
---

# Changelog

User-facing changes, new features, and notable fixes. For full commit history, see [GitHub](https://github.com/woojubb/robota).

---

## 2026-06-14 — Beta 68–76

### Breaking (SDK imports)

**Transport packages split out of `agent-transport`** — The protocol transports are now standalone
packages instead of sub-paths of `@robota-sdk/agent-transport`. Update imports:

- `@robota-sdk/agent-transport/tui` → `@robota-sdk/agent-transport-tui`
- `@robota-sdk/agent-transport/http` → `@robota-sdk/agent-transport-http`
- `@robota-sdk/agent-transport/ws` → `@robota-sdk/agent-transport-ws`
- `@robota-sdk/agent-transport/mcp` → `@robota-sdk/agent-transport-mcp`

`@robota-sdk/agent-transport` is now a lean core keeping only the `/headless` and `/testing` sub-paths.

### New features

**`@robota-sdk/agent-session-analytics`** — A new package that analyzes `~/.robota/sessions/*.json`
session logs to report timing breakdowns (LLM wait vs. tool/code time, slow intervals). Session-log
analysis moved out of the `agent-cli` thin shell into this dedicated package.

### Internal

Design-quality audit remediation (SSOT consolidation, package cohesion, error/observability hygiene)
and a round of harness/rules hardening. No runtime behavior change for existing apps beyond the import
paths above.

---

## 2026-05-23 — Beta 67

### New features

**Plugin development guide and directory** — A new [Building Plugins](/guide/plugins) guide covers the full lifecycle for writing, testing, and publishing community plugins. The [Plugin Directory](/plugins/) page lists official plugins with a process for submitting community plugins.

**`robota init` — project initialization** — Running `robota init` in any directory creates a starter `AGENTS.md` and `.robota/settings.json`. If a `.claude/` directory is detected, it offers to migrate Claude Code settings automatically.

**Local LLM support guide** — A dedicated [Local LLM Setup](/guide/local-llm) guide covers Ollama, LM Studio, and llama.cpp with per-model recommendations. No API key needed for any local inference server.

**Context warning banner** — The TUI now shows a yellow warning at 70% context usage and a red alert at 90%, with a prompt to run `/compact`.

**Improved `/compact` output** — Running `/compact` now reports how many messages were removed, the percentage reduction, and before/after context window usage.

**3-level permission memory** — The permission prompt now has a third option: "Allow always (this project)." Choosing it writes the tool pattern to `.robota/settings.local.json` so the permission persists across sessions in that project.

---

## 2026-05-10 — Beta 60–66

### New features

**Visual Agent Builder Playground** — [play.robota.io/playground](https://play.robota.io/playground) is a drag-and-drop canvas for assembling agents visually. Drag tools onto an agent node, connect providers, and watch the execution DAG build in real time. Export the canvas as working TypeScript code.

**BYOK playground** — The playground accepts your own API keys directly in the browser. Keys are passed in-request and never stored server-side.

**`maxSameToolInputs` safety limit** — Set `maxSameToolInputs` on a `Robota` agent to automatically abort a run if the same tool is called with identical inputs more than N times. Prevents infinite retry loops.

### Fixes

**Parallel DAG convergence** — Fixed a bug that created duplicate edges when multiple parallel agents converged at the same node.

**clearChat full reset** — `/clear` now fully resets the session log, DAG state, and conversation history. Previously some DAG events persisted across resets.

**Session log correlation** — Tool calls in session logs now carry consistent correlation keys, making replay-grade reconstruction reliable.

---

## 2026-05-02 — Beta 59

See the [full release notes for Beta 59](/guide/release-2026-05-02) for a detailed breakdown of all changes in this release window, including:

- Subagent background jobs with transcripts, watchdogs, and command surfaces
- Provider composition: Qwen, Gemma, Gemini, Anthropic, OpenAI, and OpenAI-compatible in one config
- Session log events for replay-grade provenance
- Deterministic parallel `Agent` tool calls via `jobs`
- CI/deploy build reuse — single monorepo root build, no per-package rebuild loops

---

## Version history

| Version          | Date       | Notes                                                         |
| ---------------- | ---------- | ------------------------------------------------------------- |
| 3.0.0-beta.67    | 2026-05-23 | Plugin guide, `robota init`, local LLM guide, UX improvements |
| 3.0.0-beta.60–66 | 2026-05-10 | Visual playground, BYOK, safety limits, DAG fixes             |
| 3.0.0-beta.59    | 2026-05-02 | Subagents, multi-provider, session replay, parallel agents    |
| 3.0.0-beta.56–58 | 2026-05-01 | [See release notes](/guide/release-2026-05-02)                |

---

## Stay updated

- Watch [GitHub releases](https://github.com/woojubb/robota/releases) for tagged versions
- Subscribe to [npm](https://www.npmjs.com/package/@robota-sdk/agent-cli) for package updates
