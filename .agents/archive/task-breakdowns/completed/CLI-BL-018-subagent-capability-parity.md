---
title: CLI-BL-018 Subagent capability parity for Robota CLI
status: completed
priority: high
urgency: now
created: 2026-04-30
branch: feat/cli-subagent-capabilities
packages:
  - agent-cli
  - agent-sdk
  - agent-core
---

# CLI-BL-018: Subagent Capability Parity for Robota CLI

## Objective

Define and implement Robota CLI subagent behavior that matches the practical capability level of Claude Code and Codex: user-requested delegation during conversation, skill-driven fork execution, discoverable agent definitions, and model-visible invocation affordances.

## Prior Art Research

- [x] Claude Code subagents, skills, and `context: fork`
- [x] Codex subagents, skills, and AGENTS.md interaction
- [x] Robota current implementation audit

### Findings

- Claude Code defines subagents as markdown files with YAML frontmatter. Project definitions live under `.claude/agents/`, user definitions under `~/.claude/agents/`, and CLI-defined agents can be passed through `--agents` JSON. Skills can use `context: fork` and `agent: <name>` so the skill content runs in an isolated agent context.
- Claude Code skill frontmatter controls both user invocation and model invocation. `disable-model-invocation: true` hides a skill from model-triggered use, while `context: fork` creates an isolated execution context.
- Codex exposes subagents through configured agent definitions and a `spawn_agent`-style tool path. Codex skills are progressive-disclosure bundles: the model sees skill name/description/path first, then reads full `SKILL.md` only when selected.
- Robota already has an SDK-owned `Agent` tool, built-in `general-purpose`/`Explore`/`Plan` definitions, `AgentDefinitionLoader`, and `createSubagentSession()`.
- Current gaps: available agents are not injected into the model-visible system prompt, `context: fork` skill slash commands are injected as normal prompts by the CLI instead of running a fork session, and custom agent discovery does not cover all Robota/Claude-compatible paths described by the desired contract.

### Sources

- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Claude Code skills: https://code.claude.com/docs/en/skills
- Codex subagents: https://developers.openai.com/codex/subagents
- Codex skills: https://developers.openai.com/codex/skills
- Codex AGENTS.md: https://developers.openai.com/codex/guides/agents-md

## Plan

- [x] Register the backlog/task and capture current implementation gaps.
- [x] Update affected SPEC.md files with the target subagent contract.
- [x] Add tests for skill fork execution, agent definition discovery, and model-visible agent invocation guidance.
- [x] Implement the smallest contract-compliant changes.
- [x] Run targeted verification for affected packages.

## Progress

### 2026-04-30

- Created this task from the user request to support Claude Code/Codex-level subagent behavior in Robota CLI.
- Started prior art and implementation audit.
- Updated agent-sdk and agent-cli SPEC files with model-visible agent invocation and deterministic `context: fork` skill execution contracts.
- Implemented model-visible agent metadata injection, Agent tool prompt description, expanded agent discovery paths, whitespace-separated `allowed-tools` parsing, custom-over-built-in agent resolution, and SDK-owned `executeSkillCommand(...)`.
- Routed CLI skill slash execution through `interactiveSession.executeSkillCommand(...)` so fork skills no longer degrade to parent prompt injection.
- Verified `agent-sdk` full tests/build/typecheck/lint, `agent-cli` full tests/build/typecheck/lint, and `pnpm harness:scan`.

## Decisions

- The existing `CLI-BL-013` worktree isolation task remains separate and covers isolation strategy only.
- This task owns invocation semantics: how users, skills, and the model trigger agent execution.
- Fork skill execution is deterministic SDK behavior, not a prompt asking the parent model to call `Agent`.
- Model-requested delegation uses the existing `Agent` function tool, with available agent names/descriptions injected into the system prompt.

## Test Plan

- Unit-test system prompt agent metadata injection and skill metadata filtering.
- Unit-test agent definition discovery order across Robota-native and Claude-compatible paths.
- Unit-test `InteractiveSession.executeSkillCommand(...)` for parent-session injection and `context: fork` isolated execution.
- Run `agent-sdk` test/typecheck/lint/build, `agent-cli` test/typecheck/lint/build, and `pnpm harness:scan`.

## Blockers

- None.

## Result

Implemented the first subagent capability parity slice. Robota CLI now routes skill slash commands through the SDK-owned skill execution path, `context: fork` skills run in an isolated subagent session, and the model-visible system prompt includes available agent metadata plus guidance to call the `Agent` tool when the user asks for delegation.

Follow-up scope remains in separate backlog items for worktree isolation and broader CLI/plugin agent definition compatibility.
