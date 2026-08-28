---
title: 'TOOL-004: built-in tool descriptions instruct the model to use parameters and mechanisms the schema and runtime reject — a compliant model gets a ValidationError or silent key-strip'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2461#issuecomment-5457939714
created: 2026-08-13
priority: high
urgency: now
area: packages/agent-tools, packages/agent-core
depends_on: []
---

# TOOL-004: builtin descriptions contradict their own schemas

## Problem

The default model-facing descriptions for the built-in tools name parameters the schemas do not
declare (in the wrong case), and assert runtime mechanisms this layer does not implement. A model
that follows the description is rejected by the validator or silently loses the key — the exact
"unenforced claims are forbidden" failure the package's NEUT-002 contract names, unguarded by the
test that claims to enforce it.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-tools/src/builtins/shell-tool-description.ts:55` — instructs a `description`
  parameter; `ShellSchema` (`shell-tool.ts:50-60`) has only `command`/`timeout`/`workingDirectory`.
- `packages/agent-tools/src/builtins/read-tool.ts:21` — says `file_path`; schema key is `filePath`
  (`:26`).
- `packages/agent-tools/src/builtins/edit-tool.ts:22,29,34` — say `old_string`/`replace_all`; schema
  keys are `oldString`/`replaceAll`.
- Enforcement: `agent-core/src/tool-registry/function-tool.ts:64-71` validates before execution;
  `parameter-validator.ts:108` rejects unknown keys with `ValidationError`; `zod-to-json-schema.ts:50-52`
  emits `additionalProperties` only for passthrough schemas (none of these are). No aliasing/
  snake_case normalization exists in agent-tools or agent-core.
- Unenforced mechanisms: `shell-tool-description.ts:52` claims working-directory persistence between
  commands — every call spawns a fresh shell (`shell-tool.ts:145`); `:57` claims 30,000-char
  middle-truncation that agent-tools does not implement (it lives in `agent-session`
  `tool-hook-helpers.ts:24`, `MAX_TOOL_OUTPUT_CHARS` in `permission-types.ts:175`); `edit-tool.ts:29`
  claims `newString` "must be different from old_string" — no such check.
- NEUT-002 (`SPEC.md:249-264`) declares descriptions a governed contract; the guard
  `builtin-descriptions.test.ts` checks none of these. Composition roots (`pack-coding/src/coding-pack.ts`,
  `dag-nodes/tool`) pass no description override, so the defective defaults are live.

## Direction

Align every default description's parameter names with its schema (`filePath`, `oldString`,
`replaceAll`), delete the `description`-parameter paragraph from the shell description (or add such a
parameter deliberately), and reword the persistence/truncation/difference claims to the real
mechanism (each command starts in the configured working directory; truncation is an injected
consumer limit, not this layer's; enforce or drop the `newString` difference claim). Extend
`builtin-descriptions.test.ts` to assert every backtick/underscore parameter name in a default
description exists in that tool's schema and that no numeric limit is asserted that this layer does
not enforce.

## Test Plan

- Red-first: extend the NEUT-002 contract test to fail on a description referencing a schema-absent
  parameter name — fails today for shell/read/edit.
- Red-first: a tool call using the description's stated parameter names succeeds (post-rename) instead
  of throwing `ValidationError`.
- `pnpm harness:verify -- --scope packages/agent-tools` green.

## User Execution Test Scenarios

**Applies** (built-in tools are the model's product surface in the CLI).

- Prerequisites: built CLI + provider key; a scratch file to edit.
- Steps: in the TUI, ask the model to make a unique-string edit to the scratch file using the edit
  tool, and to run a shell command — observe whether the edit/shell calls succeed or error.
- Expected (after fix): the model's edit/read/shell calls use the real parameter names and succeed.
- Expected (before fix, contrast): a model that follows the description emits `old_string`/`file_path`/
  a `description` arg and the call fails with an unknown-parameter `ValidationError` (or silently
  loses `replace_all`).
- Cleanup: delete the scratch file.
- Evidence (fill in after implementation): TUI transcript showing the successful tool call.
