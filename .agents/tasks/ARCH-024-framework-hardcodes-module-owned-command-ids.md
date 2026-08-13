---
title: 'ARCH-024: agent-framework hard-codes command ids owned by command modules (skills, compact, agent) in its routing/assembly while its SPEC claims "the SDK does not know command names contributed by modules in advance"'
status: todo
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-command
depends_on: []
---

# ARCH-024: framework depends on module command names it claims not to know

## Problem

The framework SPEC states "The SDK does not know command names contributed by modules in advance", and
the command-module-isolation rule says the framework must not special-case command packages. But the
framework routing/assembly hard-codes four module-contributed command ids, so it does behaviorally
depend on them — the literal SPEC claim is false, and the isolation rule is honored only in the
presence-conditional sense (no imports, but hard-coded names).

## Evidence

- `packages/agent-framework/docs/SPEC.md:1110` — "The SDK does not know command names contributed by
  modules in advance."; `project-structure.md:127` — "`agent-framework` must not import or
  special-case command packages."
- Hard-coded ids: `interactive-session-skill-router.ts:161` `getCommand('skills')` (virtual-skill
  fallback route); `assembly/create-session.ts:113-118` gates model-visible skill metadata on a
  `'skills'` descriptor; `assembly/context-capacity-hint.ts:15` `COMPACT_COMMAND_NAME = 'compact'`;
  `assembly/create-subagent-session.ts:40` denylists `'agent'` by name. (No command-package IMPORTS
  exist — that half of the rule holds.)

## Direction

Either amend the SPEC/rule to bless a small registry of "well-known command ids" (they are
presence-conditional, which is defensible) and state them once, OR inject the ids (skill-activation
command id, context-reduction command id, agent-spawn command id) as configuration from the
composition root so the framework does not name them. Recommendation: the injected-ids approach keeps
the isolation rule literally true; the well-known-registry approach is cheaper — owner's call, but the
current silent hard-coding beside a contradicting SPEC claim is the wrong state.

## Test Plan

- If injected: a test constructing the framework with alternate command ids routes correctly (the
  framework names none); if well-known-registry: the SPEC lists the ids and a test pins them.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

Not applicable — internal composition/documentation coherence; no user-facing behavior change (the
commands already work). If the injected-ids path materially changes composition APIs, add an
SDK-consumer scenario under that option.
