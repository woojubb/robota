---
title: 'DOCS-022: architecture-map tree systematically describes a repo that no longer exists — dissolved apps, phantom packages, false edges, and a missing product-assembly tier'
status: skipped
created: 2026-08-13
priority: high
urgency: soon
area: .agents/specs/architecture-map, .agents/specs/ARCHITECTURE-MAP.md, .agents/specs/orchestration-map.md
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2049#issuecomment-5461013004
---

# DOCS-022: architecture-map refresh sweep (agent-* scope)

## Resolution — terminalized as canonical issue handoff

The documented drift remains valid, but issue #2049 is the canonical owner for the bundled/source
graph and architecture-contract refresh and explicitly tracks DOCS-022/023/024. This legacy queue
record is therefore skipped rather than marked complete; a fresh Task must be recreated from the
canonical issue when implementation starts. No package source, API, policy, or runtime change is
included in this disposition.

## Problem

A 12-cluster conformance audit (2026-08-13) diffed every architecture-map claim about `agent-*`
packages against the manifests (the declared ground truth, `project-structure.md:118`) and the tree.
The map documents are systematically stale: they describe dissolved apps as live, draw dependency
edges no manifest has, omit the entire ARCH-005 product-assembly tier, and one document forbids the
exact cross-imports the architecture is built on. Several files carry "source-verified 2026-07-12"
stamps that postdate none of this drift.

## Evidence

Phantom inventory (PHANTOM):

- `apps/agent-web-monitor` (dissolved by GUI-007 into `packages/agent-cli-web`; see
  `project-structure.md:79,206-208`) is still live in SIX docs: `repository-overview.md:15`,
  `dependency-direction.md:15,54-55`, `agent-system.md:141-142,155`,
  `transport-architecture.md:27,28,88`, `apps-and-deployment.md:39,44,49`,
  `agent-cli/composition-tree.md:141`.
- Bare `agent-provider` (denied by `project-structure.md:20`) used as a real node/edge without a
  legend: `dependency-direction.md:25,75`, `agent-system.md:21,70,103,115`,
  `capability-placement.md:32,79,81`, `agent-cli/target-architecture.md:54,61,84,157,168`.
- `apps-and-deployment.md:30,43` documents an `apps/agent-web` `/monitor` route mounting
  `SessionMonitor` — the route does not exist; the real route (`/remote`) is missing from the doc.
- `orchestration-map.md:97` names the floor script `check-architecture-conformance` — absorbed into
  `check-dependency-direction.mjs` (`harness:conformance`).

False/absent edges (DOC↔MANIFEST):

- `transport-architecture.md:14` — "Packages must never cross-import each other" vs five sanctioned
  transport→transport edges (`-ws/-http/-gui/-webrtc/-webrtc-web` → `-protocol`/`-gui`) blessed by
  `project-structure.md:26-27`; `:70-71` — "transport packages depend on `agent-framework`" is true
  for 2 of 9 packages.
- `dependency-direction.md:43,45,71-72` — `Assembly→TransportShells` and `Assembly→Orchestration`
  edges exist in no manifest (`agent-framework` deps: core/executor/interface-transport/session/tools;
  neither framework nor agent-server depends on `agent-remote-client`).
- `transport-architecture.md:22-23` — `-http` consumed by `apps/agent-server` (no dep/import; -http
  has ZERO in-repo consumers — forward-provisioned) and `-gui` consumes `-ws` (gui wraps the native
  WebSocket; deps are interface-transport + transport-protocol only).
- `dependency-direction.md:60-65` / `apps-and-deployment.md:32,45` — `agent-app` → `-ws` presented as
  a production edge; it is an e2e-only devDependency (agent-app SPEC:72).
- `agent-cli/target-architecture.md:147` — `TransportWs → Framework` edge; no manifest has it.
- `dag-system.md:70` — "no `agent-*` package depends back on a DAG package" vs
  `agent-command-workflows`' six dag-* deps (documented in the same file at :28,71,85).
- Three docs give three different dependent sets for `agent-transport-protocol`
  (`project-structure.md:26`, `transport-architecture.md:21`, protocol SPEC:81); the true runtime set
  is five packages.
- `agent-system.md:19,47` draws `Framework → [agent-tools + agent-tool-mcp]`; framework has no
  agent-tool-mcp dep (its SPEC says "unconnected; forward-provisioned"); `capability-placement.md:60-64`
  explicitly corrects the same lumping.
- `transport-architecture.md:104` — claims `agent-tool-mcp` imports `@modelcontextprotocol/sdk`
  (client-side); the manifest and its SPEC:9 say no protocol SDK (global fetch).

Missing tier (UNDOCUMENTED):

- `agent-product`, `agent-capability-pack`, `pack-coding`, `agent-cli-web` appear in NO map inventory
  or diagram (`repository-overview.md:13-22`, `dependency-direction.md:9-58`,
  `agent-cli/target-architecture.md:97-151`), although `agent-cli`'s ONE composition call is
  `assembleProduct(createRobotaProfile(...))` (`cli.ts:285-292`) and the tier carries its own
  mechanical guard (ARCH-005).
- The whole `agent-cli/` map slice describes the pre-ARCH-005/007/008 composition (329-line cli.ts,
  `TCommandEffect` (deleted), `createHeadlessTransport`/`runTuiMode` (never existed in current code),
  provider effect names, preset-delta ordering) — see the product-shell audit report for the full
  list. `agent-system.md:171` still routes `/agent` spawning "via `agent-executor` contracts"
  (post-DATA-001 the contracts live in interface-transport/framework).
- `ARCHITECTURE-MAP.md:25-40` tree and reading order omit `dag-system.md`;
  `repository-overview.md:15` omits `agent-transport`'s `./programmatic` entry.

## Direction

One coherent doc-refresh pass over the architecture-map tree, mechanically re-derived:

1. Sweep `apps/agent-web-monitor` → `packages/agent-cli-web` (monitor) / `apps/agent-web /remote`
   (Stage-D) across all six documents; correct the `/monitor` route row.
2. Purge bare `agent-provider` (substitute the real `agent-provider-*` package, or add the explicit
   legend `agent-cli/class-interface-inventory.md:22` already uses).
3. Re-derive every diagram edge from the manifests (deps + peerDeps); delete or dash-and-disclaim
   ownership arrows that are not package edges (the `capability-placement.md:60-64` pattern).
4. Add the ARCH-005 tier (agent-product, agent-capability-pack, pack-coding) and agent-cli-web to the
   inventories and diagrams.
5. Re-verify the entire `agent-cli/` slice against current source before re-stamping any
   "source-verified" date.
6. Rescope `transport-architecture.md:14` to the true invariant (peer adapters never cross-import;
   `-protocol` and `-gui` are the sanctioned shared cores) and fix `:70-71`, `:104`.
7. Fix `orchestration-map.md:97` floor name; add `dag-system.md` to the router.

HARNESS-089 (filed separately) widens the mechanical guard so this drift class cannot silently
recur; this task is the one-time cleanup.

## Test Plan

- `pnpm harness:scan` green (deps Rule 9 + orchestration-map scans).
- Spot-diff: every dependency edge stated in the refreshed docs exists in a manifest; every named
  package/app resolves on disk (this becomes mechanical once HARNESS-089 lands).
- `pnpm harness:verify -- --scope .agents` equivalent doc checks (markdown lint) green.

## User Execution Test Scenarios

Not applicable — documentation-only change; no runnable user-facing behavior. Verification is the
document/claim diff in the Test Plan.
