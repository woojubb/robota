---
title: 'TOOL-005: IWorkspaceManifest.environment and .permissions are accepted contract fields the applicator silently ignores — no effect, no error, no unsupported marker'
status: done
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-tools, packages/agent-framework
depends_on: []
completed: 2026-08-29
completion: PR #2275 (312e8682a)
---

# TOOL-005: two workspace-manifest fields are dropped without a marker

## Terminal disposition

Implemented and merged by PR #2275 (`312e8682a`); issue #2027 is closed.

## Problem

`IWorkspaceManifest` declares `environment` and `permissions`, and the package's own design rule is
"unsupported capabilities return an explicit `unsupported` entry". The applicator iterates only
`entries`; the two top-level fields are accepted and dropped with no effect, no error, and no
`unsupported` marker — so a manifest author cannot tell "applied" from "ignored".

## Evidence

- `packages/agent-tools/src/sandbox/types.ts:77-86` — declares `environment?: Record<string,string>`
  and `permissions?: IWorkspaceManifestPermissions`; `docs/SPEC.md:87,100` lists both as owned
  contract types; `SPEC.md:239` promises unsupported capabilities "return explicit `unsupported`
  entries".
- `packages/agent-tools/src/sandbox/workspace-manifest.ts:17-38` — `applyWorkspaceManifest` iterates
  only `manifest.entries`; no code in the package or the sole consumer
  (`agent-framework/src/interactive/interactive-session-init-workspace.ts:10-22`) reads `environment`
  or `permissions` (repo-wide grep: zero readers). `IWorkspaceManifestApplyResult` (`types.ts:102-104`)
  can only report per-entry status, so the omission cannot even be surfaced.

## Direction

Either apply `environment` in the generic applicator (expressible via `ISandboxClient.run`/provider
option) and report `permissions` as an explicit manifest-level `unsupported` in an extended apply
result, or remove the two fields from the contract until an adapter exists. Whichever holds must be
stated in the SPEC. A forward-provisioned field is fine; a field the one applicator silently drops is
not.

## Test Plan

- Red-first: apply a manifest with `environment` and `permissions` set — assert either the env is
  applied and `permissions` returns an `unsupported` marker, or (if removed) the fields no longer
  exist on the contract. Fails today (silent drop).
- `pnpm harness:verify -- --scope packages/agent-tools` green.

## User Execution Test Scenarios

**Applies** (workspace manifests configure the CLI's tool sandbox).

- Prerequisites: built CLI; a workspace manifest fixture with an `environment` entry a shell tool can
  echo — authored by this work.
- Steps: run the CLI with that manifest; ask the model to echo the env var via the shell tool.
- Expected (after the "apply" fix): the env var is present in the tool's environment (or an explicit
  unsupported notice is surfaced).
- Expected (before fix, contrast): the env var is absent and nothing signals it was ignored.
- Cleanup: remove the manifest fixture.
- Evidence (fill in after implementation): the shell tool output showing the env var (or the
  unsupported marker).
