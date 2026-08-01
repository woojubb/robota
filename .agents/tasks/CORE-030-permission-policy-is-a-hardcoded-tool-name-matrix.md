---
title: "CORE-030: permission policy is a hardcoded product tool-name matrix with no extension seam, and an unknown tool's deny is silently dropped"
status: todo
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-core, packages/agent-tools
depends_on: []
---

# CORE-030: risk classification is owned by a name table two layers below the tools it names

## Problem

A `MyTool(secrets/**)` **deny** pattern never matches, and evaluation falls through to
`UNKNOWN_TOOL_FALLBACK = 'approve'` in `default` and `acceptEdits` modes. A tool the table does not
know about is therefore **unprotectable and defaults to approve** — silently.

Risk classification is owned by a hardcoded name table in the zero-dependency foundation, two layers
below the tools it names, instead of being declared by each tool. The two owners can drift silently,
and they already have.

## Evidence

**Layer: L0 (foundation).** Single layer, but the synthesis notes it is _the security kernel_. L0 F4:

- `packages/agent-core/src/permissions/permission-mode.ts:16-107` — a file headed _"Permission mode
  definitions for Robota CLI"_ in the zero-dependency foundation, enumerating `TKnownToolName`
  (`'Shell' | 'Bash' | 'Read' | 'Write' | 'Edit' | 'Glob' | 'Grep' | 'WebFetch' | 'WebSearch' |
'AskUserQuestion' | 'ComputerView' | 'Computer'`) and `MODE_POLICY` keyed on it.
- `packages/agent-core/src/permissions/permission-gate.ts:76-91` hardcodes each tool's argument
  schema in a `switch` with `default: return undefined`.
- The two owners can drift silently: tool names are declared in `agent-tools` as plain string
  literals with no type link (`builtins/read-tool.ts:176`, `builtins/shell-tool.ts:247`,
  `computer-use/computer-tool.ts:189`). **Drift already exists** — `'Bash'` is in the L0 matrix and no
  such tool is produced anywhere in `packages/`.
- The same package already contains the correct pattern, which makes this an inconsistency rather
  than an unknown: `packages/agent-core/src/interfaces/role-model.ts:1-13` deliberately uses an opaque
  `string` key with the reasoning for rejecting a fixed union written down.

The cause in one sentence, from the synthesis: _risk classification is owned by a name table two
layers below the tools it names, instead of being declared by each tool, so a tool the table does not
know about is unprotectable and defaults to approve._

## Why this is foundational (or not)

**FOUNDATIONAL.** The synthesis's reasoning: the table lives in the zero-dependency foundation and is
keyed on a closed union of product tool names, so no layer above — and no third-party tool author —
can register a tool's risk classification. The `default: return undefined` in `permission-gate.ts`
plus `UNKNOWN_TOOL_FALLBACK = 'approve'` makes the failure mode fail-open.

Severity HIGH, security-relevant and silent. The synthesis also cross-lists it under theme T3 (a
trust boundary that is documentation rather than code), theme T9 (`TKnownToolName`/`MODE_POLICY`
naming product tools in the zero-dep foundation), and theme T2 (`MODE_POLICY` names `'Bash'`, a tool
no package produces).

## Direction

The invariant the synthesis states for this class (theme T3): _an admission or containment decision
must be enforced by a mechanism the contract requires, not by a convention each implementation may or
may not follow_; and (theme T9) _a library must not name its consumer's product or feature set._

The synthesis names the correct pattern **inside the same package**, which is why it calls this an
inconsistency rather than an open design question:
`packages/agent-core/src/interfaces/role-model.ts:1-13` deliberately uses an **opaque `string` key**,
with the reasoning for rejecting a fixed union written down in the file. The same reasoning applies
to `TKnownToolName`.

The shape the cause sentence implies: each tool **declares** its own risk classification and argument
schema, rather than the foundation hardcoding both
(`permission-mode.ts:16-107`, `permission-gate.ts:76-91`'s `switch` with `default: return undefined`).

Two consequences the synthesis flags as part of the same work: the fail-open default
(`UNKNOWN_TOOL_FALLBACK = 'approve'` in `default` and `acceptEdits`), and the existing drift
(`'Bash'` in the matrix with no such tool produced anywhere in `packages/`).

Risk named by the evidence: tool names are currently plain string literals in `agent-tools`
(`read-tool.ts:176`, `shell-tool.ts:247`, `computer-tool.ts:189`) **with no type link** to the
matrix, so removing the union without adding the declaration seam removes the only thing that
currently couples them at all.

## Test Plan

- **Required red-first regression:** register a tool the foundation's matrix does not know (e.g.
  `MyTool`), configure a **deny** pattern `MyTool(secrets/**)`, invoke it against a matching argument
  in `default` mode, and assert it is **denied**. Against current code this must FAIL — the pattern
  never matches and evaluation falls through to `UNKNOWN_TOOL_FALLBACK = 'approve'`. Prove it fails
  before the fix.
- Repeat the same assertion in `acceptEdits` mode.
- Red-first: assert an unknown tool's argument schema is obtainable from the tool itself rather than
  from `permission-gate.ts:76-91`'s `switch`, whose `default` returns `undefined`.
- Assert the matrix no longer names a tool that no package produces (`'Bash'`), and add a mechanical
  check that the set of classified names and the set of produced tool names cannot drift — today they
  are coupled by nothing (`read-tool.ts:176`, `shell-tool.ts:247`, `computer-tool.ts:189` are plain
  literals).
- Assert no product tool names remain in the zero-dependency foundation
  (`permission-mode.ts:16-107`).
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Permission rules are a user-configured, user-visible product behaviour.

- **Prerequisites:** built `robota` CLI; a provider key. The scenario needs a tool the built-in matrix
  does not know — an MCP-provided tool or a custom tool registered through the supported extension
  path. That registration path exists; the specific scratch tool **will be created by this work** as a
  minimal fixture.
- **Steps:**
  1. Register the custom tool (e.g. `MyTool`) so the session can call it.
  2. In settings, add a **deny** rule `MyTool(secrets/**)`.
  3. Start the CLI in `default` permission mode and prompt the agent to call `MyTool` with an argument
     matching `secrets/**`.
  4. Repeat in `acceptEdits` mode.
- **Expected observable result (after the fix):** the call is **denied** in both modes, the denial
  names the rule that matched, and the tool does not execute.
- **Expected observable result (before the fix, for contrast):** the deny rule never matches, the call
  is auto-approved, and the tool executes.
- **Cleanup:** remove the deny rule and unregister the scratch tool.
- **Evidence (fill in after implementation):** the settings excerpt with the deny rule and the session
  transcript showing the denial in both modes.
