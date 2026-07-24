---
title: 'NEUT-002: agent-tools builtin tool descriptions — strip foreign product policy, add override seam'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: packages/agent-tools
depends_on: []
---

# NEUT-002: builtin tool-description policy sweep

## Problem (audit .design/audits/2026-07-24-neutrality-prompt-audit.md, core-tier findings)

Builtin descriptions are Claude-Code-era copy carrying product policy with NO override seam:

- `write-tool.ts:59` "NEVER create documentation files (\*.md) or README files" — foreign workflow policy;
  a docs-product consumer gets a tool arguing against its purpose.
- `glob-tool.ts:109` "use the Agent tool instead" — no such tool exists in this tier.
- `grep-tool.ts:254` "NEVER invoke grep or rg as a Bash command" — default tool name is `Shell`, not Bash.
- `shell-tool.ts:52-56` hardcodes sibling-tool routing (Glob/Grep/Read/Edit) regardless of registration.
- `edit-tool.ts:125` states an unenforced read-first contract.

## What

1. Strip foreign policy to mechanism-level text; fix/derive cross-tool references from the ACTUALLY
   registered tool set (or accept `description`/`routingHints` options on the create\* factories).
2. Add a description-override seam to all builtin factories (singletons → factory options).
3. Declare tool descriptions as a model-facing contract section in agent-tools `docs/SPEC.md`.

## Test Plan

Red-first unit per fixed description (asserts absence of the policy phrases + presence of derived names);
registry-subset test proves routing text matches registration.
