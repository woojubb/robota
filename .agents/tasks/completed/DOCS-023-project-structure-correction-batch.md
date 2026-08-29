---
title: 'DOCS-023: project-structure.md contradicts the manifests and itself — wrong module inventory, phantom types/packages, a layer diagram the dependency graph disproves'
status: skipped
created: 2026-08-13
priority: high
urgency: soon
area: .agents/project-structure.md
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2049#issuecomment-5461013004
---

# DOCS-023: project-structure.md correction batch

## Resolution — terminalized as canonical issue handoff

The manifest and project-structure contradictions remain valid, but issue #2049 is the canonical
owner for the architecture/source-graph and architecture-contract refresh and explicitly tracks
DOCS-022/023/024. This legacy queue record is skipped rather than marked complete; a fresh Task must
be recreated from the canonical issue when implementation starts. No package source, API, policy, or
runtime change is included in this disposition.

## Problem

`.agents/project-structure.md` is the SSOT for the package listing and dependency rules, and it
declares the manifests the ground truth (`:118`). The 2026-08-13 agent-* conformance audit found the
document contradicting the manifests — and itself — in at least eleven places.

## Evidence

1. `:16` — agent-command module inventory lists a phantom `model` module and omits seven real ones
   (`editor`, `goal`, `plan`, `preset`, `remote-control`, `schedule`, `shell`); real set is 26
   (`packages/agent-command/src/default/default-command-modules.ts:88-118`). `:323` references the
   `/preset` module that `:16` omits.
2. `:30` — lists `event-emitter` as an agent-plugin module; it is agent-core's built-in
   (`packages/agent-core/src/plugins/event-emitter-plugin.ts`); agent-plugin has 8 modules.
3. `:283` — names `TActionRequest`; the contract is `IActionRequest` (SSOT agent-core, CMD-004,
   re-exported by interface-transport), and it is the unified ask contract, not the permission dialog
   (permissions ride `permission_request`/`resolvePermission` post-REMOTE-007).
4. `:93-108` — the layered-assembly diagram contradicts the manifests: agent-session deps are
   core+interface-transport (no executor edge); agent-plugin deps are core+jssha and NOTHING depends
   on agent-plugin; agent-framework depends on executor directly and on no provider/plugin; the
   diagram names a bare `agent-provider` that `:20` denies.
5. `:27` — "-ws/-http/-mcp are contract-pure (deps: interface-transport + transport-protocol only)":
   -mcp has NO transport-protocol dep (SDK + interface-transport only, per its own SPEC:16); -ws
   additionally depends on agent-core (type-only `TUniversalValue`).
6. `:26` — protocol "shared by -ws and -webrtc"; the true dependent set is
   -ws/-http/-gui/-webrtc/-webrtc-web.
7. `:100` and `:310` — bare `agent-provider` with `/anthropic`, `/openai` subpaths; `:20` says the
   package does not exist (ARCH-PROVIDER-002). `:310` also asserts providers depend on a
   corresponding `agent-interface-*` package while `:299` admits `agent-interface-provider` is only
   "Future" and no provider manifest has such a dep.
8. `:14` — agent-product's core edge described as "agent-core types"; the code imports and calls the
   runtime value `createProviderFromConfig` (assemble-product.ts:2,136-140; SPEC-recorded owner
   decision).
9. `:15` — subagent-runner "(depends on agent-framework + agent-builtin-providers)"; the manifest
   has six edges (core, executor, framework, interface-transport, process, provider-defaults).
10. `:61` — "Remote WebRTC (`agent-transport-webrtc-web`) is an optional in-app feature" of
    agent-app; the app has no such dependency, import, or SPEC mention (aspirational-as-present).
11. `:27` — "the pairing gate must live in wireChannel, where the DTLS fingerprints … are visible":
    in code the fingerprints are captured in `start()`/the answer-signal branch
    (`webrtc-transport.ts:179-227`); `wireChannel` sees frames only. Package-level claim true;
    method-level justification imprecise.

Also (shared root with the maps): `:25` describes agent-transport as owning "scripted-provider
testing fixtures" that are a pass-through of agent-core/testing (STRUCT-008 pending; doc should say
"re-exports … pending STRUCT-008").

## Direction

Correct all eleven sites against the manifests/code. For the layer diagram (item 4), either redraw
from the derived graph or annotate it explicitly as conceptual tiers, not dependency edges — today it
reads as edges and is disproven by the document's own ground-truth rule. Prefer pointing inventories
at mechanically-derived lists over hand-maintained enumerations (the `:16` inventory drifts
repeatedly; the audit found the same list wrong in agent-preset's SPEC too — see DOCS-024).

## Test Plan

- Every dependency claim in the edited document diffs clean against `packages/*/package.json`.
- Every named package/module/type resolves on disk (`rg` spot checks; mechanical once HARNESS-089
  lands).
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — documentation-only change; verification is the manifest diff in the Test Plan.
