# SDK Skill Activation Runtime Contract

## Status

Backlog.

## Created

2026-05-06

## Priority

P1 - skill invocation correctness and auditability.

## Problem

Robota exposes discovered skills to the model as prompt descriptors, but model-side skill activation
does not currently have a deterministic runtime contract. This lets the model read a skill name or
description, claim that it applied a skill, and imitate the workflow in prose without invoking any
SDK-owned skill execution path.

Users cannot reliably distinguish these cases:

- A user-invoked slash skill was executed by `InteractiveSession.executeSkillCommand(...)`.
- A model saw a skill descriptor and followed the general idea in plain text.
- A model claimed a skill was active even though no runtime skill activation occurred.

This breaks trust in the skill system because "using a skill" becomes an unverified narrative claim
instead of a recorded runtime event.

## Current Evidence

- `.robota/sessions/session_1778075480820_kb29mfvjc.json` records a user testing whether a backlog
  creation request triggered `task-tracking` or `spec-writing-standard`.
- The assistant first claimed that it used skills after writing a task file, then admitted that no
  explicit skill call occurred and that it only imitated a skill-based process.
- The session record includes `systemPrompt` skill descriptors and `toolSchemas`, but there is no
  structured skill activation list, activation event, or tool-call record proving that a skill was
  invoked.
- `packages/agent-sdk/src/assembly/create-session.ts` injects model-visible skill descriptors into
  the startup prompt through `SkillCommandSource(cwd).getModelInvocableSkills()`.
- `packages/agent-sdk/src/tools/command-execution-tool.ts` executes only registered
  model-invocable system commands. It does not execute `SkillCommandSource` entries.
- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts` emits a visible `skill-invocation` event only
  for slash-routed user skill commands.

## Scope

- `packages/agent-sdk/src/commands/skill-source.ts`
- `packages/agent-sdk/src/commands/skill-executor.ts`
- `packages/agent-sdk/src/interactive/interactive-session.ts`
- `packages/agent-sdk/src/interactive/session-persistence.ts`
- `packages/agent-sdk/src/tools/command-execution-tool.ts` or a dedicated skill activation tool
- `packages/agent-sdk/src/context/system-prompt-builder.ts`
- `packages/agent-sdk/docs/SPEC.md`
- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts`
- `packages/agent-cli/src/ui/MessageList.tsx`
- `packages/agent-cli/docs/SPEC.md`
- `.agents/specs/agent-invocation-router.md`

## Recommended Direction

Introduce a first-class skill activation contract owned by `agent-sdk`.

Recommended architecture:

- Keep `SkillCommandSource` as the SSOT for skill discovery and metadata.
- Add an SDK-owned model-callable activation path for model-invocable skills, either as
  `ExecuteSkill` or as an expanded command execution tool that can dispatch skill descriptors as
  capability entries.
- Emit a structured `skill-activation` event for every real skill activation with skill name,
  source, invocation method, execution mode, timestamp, and result status.
- Persist skill activation events in session records alongside tool, background task, memory, and
  context reference events.
- Render visible TUI feedback for both user-invoked and model-invoked skills. A skill must only be
  shown as active after the SDK has emitted the activation event.
- Keep startup prompt skill entries as descriptors only. Full `SKILL.md` content should be loaded
  only through the activation path.
- Add prompt guidance that skill descriptors are available capabilities, not instructions that have
  already been activated.

Recommended event shape:

```ts
interface ISkillActivationEvent {
  readonly type: 'skill-activation';
  readonly skillName: string;
  readonly source: 'skill' | 'plugin';
  readonly invocation: 'user-slash' | 'model-tool';
  readonly mode: 'inject' | 'fork';
  readonly status: 'started' | 'completed' | 'failed';
  readonly timestamp: string;
  readonly qualifiedName?: string;
  readonly error?: string;
}
```

## Constraints

- Do not make the CLI own skill execution policy. The CLI may render events and route slash input,
  but the SDK must own activation semantics and persistence.
- Do not dump full skill bodies into the startup system prompt.
- Do not report a skill as activated unless the SDK emitted a structured activation event.
- Do not let prompt prose alone satisfy skill execution requirements.
- Keep `disable-model-invocation` semantics authoritative for model-side activation.
- Keep `user-invocable: false` semantics authoritative for slash-side activation.

## Acceptance Criteria

- [ ] Model-invocable skills have a deterministic SDK activation path.
- [ ] A model cannot truthfully claim skill activation without a persisted activation event.
- [ ] User slash skill execution and model skill execution both emit `skill-activation` events.
- [ ] Session persistence stores and restores skill activation events.
- [ ] The TUI renders skill activation status from SDK events, not local heuristics.
- [ ] Startup prompt skill entries remain descriptor-only.
- [ ] Tests prove that a plain textual reference to a skill does not create an activation event.
- [ ] Tests prove that activating a skill through the SDK path records the event.
- [ ] SDK and CLI SPEC files document the skill activation contract.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-sdk test -- skill`
- `pnpm --filter @robota-sdk/agent-sdk test -- interactive-session-skill-command`
- `pnpm --filter @robota-sdk/agent-cli test -- slash-routing-effects message-list-rendering`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- `pnpm --filter @robota-sdk/agent-cli lint`
