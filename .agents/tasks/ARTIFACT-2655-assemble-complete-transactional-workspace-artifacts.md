---
title: 'ARTIFACT-2655: Assemble complete transactional workspace artifacts'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# ARTIFACT-2655: Assemble complete transactional workspace artifacts

## Objective

Make root and affected builds discover complete publishable artifact tasks, including copied web assets. Assemble node/types/web in staging, commit complete dist generations atomically, derive exact emitted/packed manifests, and verify stale-file and partial-failure rejection.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

Spec: `.agents/spec-docs/active/ARTIFACT-2655-assemble-complete-transactional-workspace-artifacts.md`.

Owner decision (verbatim, 2026-09-12): "windows 빌드의 원자성 보장 제외를 허용합니다."
Windows remains a supported build path with staging, complete-output validation and failure recovery;
only atomic replacement is exempted. Subsequent owner decision (verbatim, 2026-09-12):
"dist 최초 전환도 승인합니다." This separately allows the first legacy-output transition with
backup, explicit interruption/recovery handling and no atomicity claim. Normal Linux/macOS managed
publication remains atomic. The paired spec records both exceptions and their verification scope.

Source acceptance: [Issue #2154](https://github.com/woojubb/robota/issues/2154), transferred to the umbrella by its [recorded disposition](https://github.com/woojubb/robota/issues/2154#issuecomment-5642810131). The original complete, atomic and exact artifact criteria remain binding except for the two explicit atomicity exceptions above.

Independent recommendation review, Carson, 2026-09-12: `REVIEW VERDICT: ENDORSE` (revision 1).
The existing full-scope Task addresses the foundational cause; no new Task is required.

## Plan

- [x] Validate the detailed design against current code and inherited source criteria, including TC-07 legacy and Windows transition boundaries.
- [ ] Implement TC-01 complete graph/assembly, TC-02 publication and recovery, TC-03 exact emitted manifests, and TC-04 exact pack consumers with failure-reproducing regressions.
- [ ] Verify TC-05 real release-path corpus and TC-06 current clean framework-only partial build/test; prepare CI and delivery evidence.

## Delivery

Merge into origin/develop after verification and record the delivering commit in the source Issue.

## Progress

2026-09-13 integration checkpoint (not delivery):

- Real root `pnpm build` exited 0 with `artifact workspace build: PASS tasks=82` after making
  canonical declaration emission ESM-owned (CJS no longer emits a conflicting duplicate `.d.ts`).
- All 37 public package archives were produced by `packVerifiedPackage` after exact tar verification;
  no registry publication occurred. CLI copied web output is included. pnpm's asynchronous workspace
  dependency conversion can reorder dependency-map keys: verification normalizes only those four
  maps, compares all metadata values and all other key order (including export conditions), requires
  exact pnpm JSON serialization, and retains actual file/archive byte hashes for publication.
- Focused emission, staging/recovery, exact packing, transfer, real release-corpus and pinned web
  request regressions have passed. Real root build is macOS evidence; Linux clean framework-only
  acceptance and native Windows execution remain CI obligations, not inferred passes.
- The parent Issue #2655 stays open: this artifact outcome is still being integrated and BOUNDARY-2655
  remains outstanding. Existing INFRA delivery evidence is retained, not re-planned.

Integrated verification and repairs:

- Web-only affected build: 67 tasks, exit 0, no global fallback; ordered web producer and CLI each
  execute once. Real output-contract scan reads and passes all 82 packages. Its initial 29 missing
  `module=dist/node/index.mjs` failures exposed private manifest drift; metadata now matches the
  already-existing ESM `.js` export and compiler output, without changing exports.
- Main integration: 151 artifact/planner tests, 112 output/release checker tests, 23 release
  governance tests, CLI typecheck and 12 web-reader tests passed. Later supplement integration was
  139 pass / 1 fail: an obsolete inline CI archive assertion; its owner repaired the assertion
  against the transfer boundary and reported all 52 classifier tests passing.
- Real outside-repository proof: 24 verified tarball installations, shipped declaration typecheck,
  and 72 Mode A/B/C assertions passed. Initial executions exposed the macOS logical/physical path
  mismatch (focused RED→GREEN) and a stale fixture import of the removed global preset resolver;
  the fixture now uses the existing instance-scoped public factory. No product API was changed.
- Real CLI Bun host compilation and binary `--version` passed with Node generation unchanged;
  Node and binary variants were independently pinned and verified. `pnpm docs:build` passed.
- Chrome via cua_repl loaded actual CLI web artifacts through the real server: monitor connected,
  with no application exception. The existing implicit favicon 404 is recorded in LRN-cli-monitor-missing-favicon;
  a clean-console claim is not made. This used a local WebSocket probe, not a provider invocation.
- Changed SPEC claims: independent comparison found SPEC→code 22/22 and code→SPEC 16/16 matches.
  Existing scan predicates now exclude generation storage as generated output. Release governance
  checks verified-set preparation and publication instead of insisting on obsolete recursive packing.
  Native Linux clean-partial and Windows executions, final review, remote CI and merge remain pending.

Local review repair batch (Round A):

- Hume reported three actionable findings; Pascal independently classified all three LOCAL
  (0 foundational). They are repaired as one batch, not three separate PRs.
- Compiler watch scripts could mutate a sealed generation. All 31 raw compiler-watch entries now
  use the existing complete assembler through an input-only native watcher. Real compiler fixtures
  reproduce the old mutation and verify rebuild, failure preservation and shutdown (7 focused tests).
- Node CLI version discovery depended on output depth. Node builds now inject the same manifest
  version constant as Bun. Actual managed-entry/launcher execution changed from `0.0.0` (RED) to
  `3.0.0-beta.79` (GREEN); a newly verified tarball installed outside the repository reports the same
  version, with ordinary Node/web files. CLI build and typecheck passed after the fix.
- Concurrent recovery could delete a newly acquired writer lock. Recovery now claims exclusively
  before reading ownership and detaches only the claimed lock before cleanup. Crashed claims retain
  owner records and require explicit quiescent repair. Focused regressions passed 19 tests, including
  four existing real-process interruption cases. Main independently reproduced the post-format
  integrated artifact/planner/release batch: 270/270 PASS, plus actual CLI version 1/1 PASS.
- The approved verified-tarball path replaces contradictory recursive-directory publish guidance
  in its existing owners; the release governance suite passes 23 tests. A patch changeset names all
  37 changed public packages for the later coordinated release. No npm publication is authorized or
  performed by this artifact delivery.
- Supplemental CLI version SPEC→code and code→SPEC both match: manifest injection in the Node and
  Bun builders implements the new claim, and startup consumes the same constant. Reuse the earlier
  conformance run for unchanged claims. Final 161-scan run had one generated-file citation failure;
  it is corrected with the existing explicit generated-artifact annotation and checked separately.
- Hume's single repair-batch re-review resolved all three original findings and returned
  `ACTIONABLE FINDINGS: 0`. This records local convergence only; CI and merge acceptance remain open.

PR #2715 first CI repair batch:

- Published head `14af7c9812caa065b0fdb8ba29e73a403dc66800` after a non-overlapping rebase and
  verified formatting-only amendment. The local verdict and 13-context control-plane job confirmation
  are recorded on the PR. Workflow provenance remains intentionally red; owner-only landing applies.
- CI run 34703411516 exposed a real configuration-loader compatibility failure on Node 22.23.2:
  `ENOENT node:fs?tsx-namespace`. Main reproduced it on that exact runtime (15 pass / 1 fail), then
  replaced the loader with the already-installed public `unrun` API and package-owned external
  resolution. The same 16 emitter/build/watch tests pass on both 22.14.0 and 22.23.2; actual core
  assembly also passes on 22.23.2. No dependency, runtime declaration or public compiler-private API
  was added; execution on 22.14 is not a claim that tsdown officially supports that version.
- Independent CI triage classified the remaining failures as harness infrastructure: two stale
  archive/publish assertions, four interactive shell-fixture startup failures, the copied web
  declaration-graph count, two undeclared CI-owned steps and four stripped-image import failures.
  Independent scans themselves passed (157 pass, 2 skip); negative-fixture console output is not
  reported as another repository defect. The repair keeps all assertions/tiers and restores missing
  execution dependencies without including live package, app, rule or Git owners in the stripped image.
- Stripped-image imports reproduced RED then GREEN in an ordinary temporary directory, without any
  Git fixture. Main focused mapping/image checks pass 51 tests. Remote CI must re-execute before
  delivery is accepted; no successful native Windows or clean Linux result is inferred from these runs.
- Nash reproduced and repaired the three stale/startup test groups (121 focused tests pass).
  Actual CLI assembly and its version regression also pass under the repaired loader. The original
  code review is not repeated after PR creation; the next push is grounded in the published red CI
  run and its recorded repair scope, not in a request for another opinion.
- Main post-format integrated repair verification on Node 22.23.2: 191/191 tests passed across
  nine files, including real release-path fixtures. Native CI remains the platform acceptance owner.

## Test Plan

Focused positive/negative regressions plus actual execution at the owning boundary. Verify every
requirement in Objective and the source Issue before marking this Task complete.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** ARTIFACT-2655 changes internal artifact assembly, storage, replacement and publication.
The initial-transition and Windows atomicity exceptions remain within that boundary; installed CLI
commands, web-monitor interactions and public API behavior are preserved. No new product interaction
is introduced. Nash independently confirmed this applicability decision on 2026-09-12.
