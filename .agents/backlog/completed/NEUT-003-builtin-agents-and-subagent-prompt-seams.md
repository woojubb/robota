---
title: 'NEUT-003: built-in agents de-doctrine + injection seam; subagent suffix seam'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

# NEUT-003: built-in agent + subagent prompt seams

## Problem (audit .design/audits/2026-07-24-neutrality-prompt-audit.md)

- `built-in-agents.ts:11` embeds house doctrine ("strict types, no fallbacks, proper error handling") —
  `.agents/rules` vocabulary shipped to every SDK consumer.
- Built-ins are force-merged: shadowable by name but not removable/replaceable as a set.
- `subagent-prompts.ts` mandates style (≤500 words, no emojis, absolute paths) with no caller seam
  (`create-subagent-session.ts:167-172` appends unconditionally).
- `agent-tool.ts:86` zod description hardcodes the three built-in names (drifts vs custom registries).

## What

1. Delete/generalize the doctrine sentence ("match the conventions stated in the project's instruction files").
2. `builtInAgents?: IAgentDefinition[]` injection seam (default = current three; empty array allowed).
3. `ISubagentOptions.suffix?: string | ((ctx)=>string)` with current text as default; consider relocating
   default text to the defaults/preset layer.
4. Derive the schema description from injected definitions; document the `general-purpose` fallback in SPEC.
   Also fold: `SELF_VERIFICATION_CONTENT` becomes a string-valued seam (text liftable to preset);
   `claudeMd` contract field → neutral name (breaking; beta).

## Test Plan

Red-first: doctrine-phrase absence; replace/remove built-in set round-trip; custom suffix honored;
schema description reflects a custom registry.

## Outcome (2026-07-25)

All four items + fold-ins shipped (red-first each):

1. Doctrine sentence in `built-in-agents.ts` replaced with neutral mechanism text ("Match the
   conventions stated in the project's instruction files"); doctrine-absence test added.
2. `builtInAgents?: readonly IAgentDefinition[]` seam on `IInProcessSubagentRunnerDeps` (thus
   `IAgentToolDeps`), the in-process runner, fork resolution, and the `AgentDefinitionLoader`
   constructor — supplied set REPLACES the default three; empty array removes all built-ins.
3. `ISubagentOptions.suffix` / `ISubagentPromptOptions.suffix` (`TSubagentSuffix =
string | ((ctx) => string)`) replaces the framework suffix; current texts stay as the
   documented defaults.
4. Agent-tool `subagent_type` schema description now DERIVED from the session's agent
   definitions (`agentDefinitions` → `builtInAgents` → default set); `general-purpose`
   fallback documented in SPEC.
   Fold-ins: `selfVerification` is now `boolean | string`
   (`createSelfVerificationSection(content?)` — text replaceable, liftable to preset);
   `claudeMd` contract field renamed to the neutral `projectNotesMd`
   (+ `projectNotesFileEntries`, `createProjectNotesSection`; breaking, beta line).
