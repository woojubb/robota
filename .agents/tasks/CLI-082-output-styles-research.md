---
title: 'CLI-082: response shape can only be changed by rewriting the system prompt — output styles research pass'
status: in-progress
created: 2026-08-22
priority: high
urgency: now
area: packages/agent-framework, packages/agent-command, packages/agent-cli
depends_on: []
issue: https://github.com/woojubb/robota/issues/1988
---

# CLI-082: output styles — the research pass issue #1988 requires

## Why this record exists before any code

Issue #1988 gates itself: _"This issue is a gap and a candidate, not a design and not an approval.
Do not start writing code from it."_ It requires four things recorded before implementation — a
re-read of the reference behaviour, a provider-neutral form, a survey of existing seams, and a
per-line verdict with alternatives and a reviewer sign-off.

This record carries that pass. **Step 3 is complete and measured below. Steps 1, 2 and 4 are
outstanding**, and implementation does not start until all four are done and signed off.

## The gap, confirmed rather than assumed

`grep -rn outputStyle packages/*/src apps/*/src` → **0 occurrences**. The issue's claim holds on the
current tree.

The only existing levers are `--system-prompt` (replace) and `--append-system-prompt` (append), both
print-mode flags: a REPL user cannot reach them, and nothing persists, names or shares the result.

## Step 3 — the existing seam (COMPLETE)

**`buildSystemPrompt` in `packages/agent-framework/src/context/system-prompt-builder.ts` is the seam,
and it already carries a precedent for exactly this shape.**

```
ISystemPromptParams.language?: string        // :56–57
appendOptionalSection(sections, createResponseLanguageSection(params.language));   // :143
```

The builder assembles ordered, optional sections. `/language` does not rewrite a prompt — it supplies
a parameter that becomes one section among others. An output style is the same kind of thing at the
same seam: a named, optional section with a documented position.

**So the design question is not "where does a style attach" — that is answered — but "what is a style
allowed to REPLACE".** Claude Code's answer is `keep-coding-instructions`, defaulting to false,
meaning a custom style replaces the built-in engineering instructions unless the author says
otherwise. In this builder that maps onto whether a style suppresses other sections or only adds one,
which is a property of section assembly and not of the style file.

**The `/language` interaction the issue asks about is therefore already constrained**: both are
sections of one prompt, and the question is ordering and mutual suppression, not two mechanisms
competing to own the prompt. `packages/agent-framework/src/command-api/host-roles.ts:81` (ARCH-040)
already re-applies a preset's response language to the live system prompt, so a live-update path
exists and a style should use it rather than inventing a second one.

**Command surface precedent:** `packages/agent-command/src/language/language-command.ts` is 52 lines
and delegates parsing and subcommand construction to `agent-framework`. A style command that does
more than that is doing something the language command found unnecessary.

## Step 1 — re-read the reference behaviour (OUTSTANDING)

The checklist in issue #1988 is a snapshot taken 2026-08-22 and the source moves weekly. Each line
must be re-confirmed against the live documentation and any change noted. **Not done.**

## Step 2 — provider-neutral form (OUTSTANDING)

A style is prompt text, which is the most portable thing there is — but the checklist also carries
_"token cost is stated per style"_, and token accounting differs per provider. What each supported
provider maps onto, and what a provider without an equivalent does instead, is unwritten. **Not
done.**

## Step 4 — per-line verdict, alternatives, sign-off (OUTSTANDING)

Every checklist line must be adopted, adapted, or rejected **with a reason** — the issue is explicit
that silently skipping a line means the gate is not met. Then the alternatives considered, why the
chosen one wins, and a reviewer sign-off. **Not done, and implementation does not begin until it
is.**

## Scope note

This is Track E's first item under the P\* distribution. `#1990` (tool search) is deliberately NOT
paired with it in time: the tool surface is nine default tools today, so "enumerated in full on every
request" has no measurable cost until MCP lands via issue #1985, and building deferral before there
is a surface to measure would ship a mechanism whose benefit nobody observed.

## Test Plan

- The research pass itself is the deliverable of this record; its gate is the reviewer sign-off in
  step 4, not a test run.
- Implementation, once approved, carries its own plan: section ordering and suppression asserted
  against `buildSystemPrompt` directly, and a case proving a style that sets
  `keep-coding-instructions` retains the engineering sections while one that does not removes them —
  the two states must be told apart by a test, because the default is the destructive one.

## User Execution Test Scenarios

Not applicable to this record — it delivers a research pass, not runnable behaviour. The
implementation that follows will carry scenarios against the REPL, which is the surface the issue
names as the one a user meets on every turn.
