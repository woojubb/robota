---
title: 'CLI-1988: P0 output styles: make response style a persistent, selectable, provider-neutral session prompt surface'
issue: https://github.com/woojubb/robota/issues/1988
status: done
created: 2026-09-10
priority: medium
urgency: now
area: agent-command, agent-preset, agent-framework, agent-cli
depends_on: []
completed: 2026-09-10
---

# CLI-1988: P0 output styles: make response style a persistent, selectable, provider-neutral session prompt surface

Spec: `.agents/spec-docs/done/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md`

## Objective

Deliver the output-style capability tracked by GitHub issue #1988 as one provider-neutral feature:
named built-in and custom response styles must be selectable at startup and from the interactive
command surface, persist at the appropriate settings scope, and contribute to the session's existing
system-prompt composition without replacing repository instructions or duplicating the preset/prompt
seams.

## Plan

- [x] Re-read the current reference behavior and survey the existing preset, settings, command, and
      system-prompt seams; record one cause and the chosen design in the paired spec.
- [x] Define the provider-neutral style contract, built-in styles, custom Markdown loading and
      precedence, prompt-cache/token-cost semantics, and interactions with language, presets, forks,
      plugins, and permission mode.
- [x] Add startup and interactive selection that persists through the existing settings ownership
      boundary and applies the selected style through the existing system-prompt update path.
- [x] Add focused unit, integration, and product-surface verification for built-in/custom styles,
      precedence, prompt composition, persistence, and safe failure behavior.

## Research and Recommendation

The cause is one missing provider-neutral concept: the repository already has separate seams for
preset discovery, settings persistence, command host actions, and prompt rebuilding, but none of
those seams carries a named response-style value. The old `--system-prompt` and
`--append-system-prompt` paths therefore remain one-shot prompt controls rather than a selectable,
inspectable session setting. Splitting the feature by package would create several competing owners;
this Task keeps one contract and one end-to-end verification outcome.

The live reference was re-read on 2026-09-10 from
https://code.claude.com/docs/en/output-styles. The paired spec records the current checklist
verdicts, the provider-neutral mapping, and the deliberate Robota adaptations. The existing seams
were surveyed locally in `agent-preset`, `agent-framework`, `agent-command`, `agent-interface-command`,
and `agent-cli`; the design extends those seams and does not make a provider-specific branch.

Recommended design: `agent-preset` owns immutable built-in/custom style values and Markdown decoding;
`agent-framework` owns the neutral prompt section and retained live-rebuild state;
`agent-interface-command` owns only the host-action discriminator; `agent-command` owns the
`/output-style` selection/list command; and `agent-cli` owns safe source discovery, startup
precedence, and user-settings persistence. Core Robota instructions, permissions, tools, skills,
and project instructions are always retained even when a custom style has
`keep-coding-instructions: false`; this is an explicit security-preserving adaptation of Claude's
replacement behavior.

The current user instruction prohibits subagents and additional worktrees. The research and
adversarial checks are therefore local and explicit in the paired spec; no independent delegated
reviewer is used.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: select a built-in style for a new CLI session

- **Executability:** agent-executable
- **Product surface:** robota-cli
- **Surface rationale:** shipped-entrypoint=robota
- **Command:** `robota -p "Explain the current directory in one sentence" --output-style concise`
- **Prerequisites:** a configured provider or the deterministic replay fixture, plus a shell in the repository root
- **Observable type:** product-output
- **Observable rationale:** source=product-process
- **Expected observable:** exit=0; output-contains=Output style: Concise (concise; input cost low)
- **Cleanup:** no persistent project files are changed by the one-shot flag
- **Evidence:** the built CLI binary with the deterministic replay fixture exited 0, reported the concise style, and returned `CROSS_FIDELITY_OK`. <!-- evidence-superseded: the dist path is a generated build output; reproduce with the command above after `pnpm build`. -->

### Scenario 2: switch a custom project style through the CLI command path

- **Executability:** agent-executable
- **Product surface:** robota-cli
- **Surface rationale:** shipped-entrypoint=robota
- **Command:** `robota -p "/output-style brief"`
- **Prerequisites:** a trusted project containing `.robota/output-styles/brief.md` and a configured provider
- **Observable type:** product-state-file
- **Observable rationale:** source=robota-state-artifact
- **Product state path:** .robota/settings.json
- **Expected observable:** change=updated
- **Cleanup:** remove the temporary style file and discard the throwaway HOME
- **Evidence:** the built CLI returned `Switching output style to Brief Project...` and `Output style: Brief Project`; `jq -r .outputStyle` returned `brief`, and the temporary project style and HOME were cleaned up. <!-- evidence-superseded: the dist path is a generated build output; reproduce with the command above after `pnpm build`. -->
