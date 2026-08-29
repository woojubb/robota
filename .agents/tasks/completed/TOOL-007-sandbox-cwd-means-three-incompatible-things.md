---
title: 'TOOL-007: the sandbox ISandboxToolOptions.cwd field means three incompatible things across the contract doc, the shell tool, the file tools, and the README — a consumer cannot determine its semantics'
status: skipped
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-tools
depends_on: []
---

# TOOL-007: `cwd` has three contradictory meanings

## Problem

`ISandboxToolOptions.cwd`'s SSOT doc says host-only containment root; the shell implementation uses it
as the sandbox-internal working directory; the file tools ignore it in sandbox mode (with no path
guard); and the README says it roots/contains sandbox access. A consumer cannot determine the field's
semantics from any one source, and the "containment boundary" the doc promises is not enforced for
sandboxed file operations.

## Evidence

- `packages/agent-tools/src/sandbox/types.ts:122-137` — `cwd`: "The tool's working-directory root **on
  the host (non-sandbox) path** … a CONTAINMENT boundary."
- `packages/agent-tools/src/builtins/shell-tool.ts:128-129` — in sandbox mode `options.cwd` is passed
  as the SANDBOX-internal working directory (`runInSandbox(command, timeout, workingDirectory ??
options.cwd, …)`).
- `read-tool.ts:105-118` / `write-tool.ts:29-32` / `edit-tool.ts:43-46` — in sandbox mode `cwd` is
  unused and NO path guard runs.
- `packages/agent-tools/README.md:105-106` — tells consumers "`cwd` is required even with a sandbox
  client: it is the root inside the sandbox, and the host path guard still applies to any tool that
  falls through to the host filesystem" — which no code does for the file tools.

## Direction

Define per-mode semantics in `ISandboxToolOptions.cwd`'s doc and correct the README: host containment
root for host-mode file tools; default working directory for Shell in both modes; inert for sandboxed
file ops. If sandbox-path containment is actually intended (the README implies it), implement the
guard for sandboxed file tools; otherwise state plainly that it does not apply. The doc, the shell,
the file tools, and the README must agree on one meaning per mode.

## Test Plan

- Red-first (if containment is intended): a sandboxed read/write outside `cwd` is rejected — fails
  today (no guard). If doc-only: a test asserting the documented per-mode semantics match the code
  paths.
- `pnpm harness:verify -- --scope packages/agent-tools` green.

## User Execution Test Scenarios

**Applies** (sandbox tools are a CLI product surface when a sandbox client is configured).

- Prerequisites: built CLI with a sandbox client configured; a `cwd` set.
- Steps: ask the model to read/write a path outside `cwd` in sandbox mode, and to run a shell `pwd`.
- Expected (after fix): behavior matches the documented per-mode semantics (shell runs in `cwd`; file
  access outside `cwd` either contained or documented as uncontained — consistently).
- Expected (before fix, contrast): the shell honors `cwd` while file tools ignore it, and the README's
  containment claim does not hold.
- Cleanup: none.
- Evidence (fill in after implementation): tool outputs demonstrating the consistent semantics.

## Terminal disposition

Skipped as duplicate of canonical open GitHub issue #1999: https://github.com/woojubb/robota/issues/1999.
The issue owns the unresolved sandbox cwd semantics for future conversion to a fresh backlog item.
