---
title: 'CLI-081: agent-cli non-interactive flags reach the model by string-appending behavioural instructions to the system prompt, so a product flag semantics lives in a literal no SPEC owns — project-structure.md:113 forbids exactly this, and the scan that enforces it cannot see the site'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2056#issuecomment-5455752323
created: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-cli, scripts/harness
depends_on: []
---

# CLI-081: a product flag implemented as a prompt string

Filed under [finding-depth.md](../rules/finding-depth.md) from a `DEPTH: FOUNDATIONAL` verdict
(`finding-depth-triager`, 2026-08-16). Independent of the item that surfaced it.

## Problem

`--json-schema` (`packages/agent-cli/src/utils/cli-args.ts:49,269`) is implemented by appending an
instruction to the system prompt:

```ts
// packages/agent-cli/src/startup/append-system-prompt.ts:26-28
if (args.jsonSchema)
  appendParts.push(`Respond with valid JSON only, matching this JSON schema:\n${args.jsonSchema}`);
```

So the flag's semantics are a literal in a helper, not an owned option. Two problems:

1. **[project-structure.md](../project-structure.md) `:113` forbids it** — "no invented
   prompt/protocol directives … instruction strings … to force behavior". This is a mandatory rule,
   and the site predates its discovery by months (landed with the flag under CLI-053/054/055).
2. **The mechanical floor cannot see it.** `scripts/harness/scan-prompt-prose.mjs` does scan
   `packages/agent-cli/src`, and has no baseline entry for this file — because its sinks are
   `description:` fields, `*PROMPT` constants and `.describe()` calls, and this is an inline `push`
   into a local array. A rule with a guard that cannot reach the violation is a rule that reports
   clean.

The second is the more important half: fixing the flag without widening the scan leaves the next
inline-append unguarded.

## Direction

Route the flag through an owned option rather than a prompt string — the core already carries
structured-output intent as data (`IChatOptions.responseFormat`, `IAgentConfig.responseFormat`), so
the CLI can express the request instead of narrating it. Then widen `scan-prompt-prose.mjs` so an
inline push of an instruction literal into a prompt-assembly array is a sink it recognises, and add a
baseline entry only for anything deliberately kept.

Note the ordering constraint: routing the flag through the core option makes its behaviour depend on
whatever CORE-043 decides about non-native providers. Landing the **scan widening** first is
independently valuable and unblocked.

## Relationship to other items

- **CORE-043** cited this site as inconsistent with its own scope-out of prompt injection. That
  observation is correct and is what surfaced this item, but nothing in CORE-043's design depends on
  it — the coupling was rhetorical.
- **HARNESS** items covering scan coverage floors are the natural home for the second half if it is
  split.

## Test Plan

- A red-first scan fixture: an inline instruction literal pushed into a prompt-assembly array is a
  finding before the widening and after it only if unbaselined.
- A test pins that `--json-schema` produces a structured-output request rather than an appended
  instruction.
- `pnpm harness:verify -- --scope packages/agent-cli` green; `pnpm harness:scan` green.

## User Execution Test Scenarios

Applies — this changes what the flag does on the wire, and the CLI is the product surface.

**Scenario 1 — the flag requests structured output rather than describing it**

- Prerequisites: a provider API key exported; `pnpm build`.
- Environment: the `robota` CLI itself, no fixture needed.
- Steps: run the CLI in print mode with `--json-schema '<a small schema>'` and a prompt, and inspect
  the system prompt the run actually sent (the session log records it).
- Expected observable result: the system prompt contains **no** "Respond with valid JSON only"
  instruction, and the response still conforms to the schema.
- Cleanup: none — remove the session log if desired.
- Evidence: _to be filled after implementation_.
