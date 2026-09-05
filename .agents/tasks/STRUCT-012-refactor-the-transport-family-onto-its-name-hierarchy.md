---
title: 'STRUCT-012: refactor the transport family onto its name hierarchy'
status: in-progress
created: 2026-09-05
priority: high
urgency: soon
area:
  - scripts/harness/check-dependency-direction.mjs
  - packages/agent-transport
  - packages/agent-transport-protocol
  - packages/agent-framework
  - packages/agent-transport-ws
  - packages/agent-transport-http
  - packages/agent-transport-webrtc
  - packages/agent-transport-gui
  - packages/agent-transport-webrtc-web
  - packages/agent-transport-tui
  - packages/agent-ui-web
  - packages/agent-ui-terminal
  - packages/agent-cli
  - .github/workflows/ci.yml
  - .agents/project-structure.md
  - ARCHITECTURE.md
depends_on: []
no-issue: the owner directed this item to be created locally as a foundational root item — "현재 더이상 이방향으로 처리하지 말고 파운데이셔널 이슈로 로컬에 새로 생성하고 리팩터링 진행하세요" (2026-09-05); registration on GitHub is the owner's step after the spec is read
---

# STRUCT-012: refactor the transport family onto its name hierarchy

This record **absorbs** the earlier `STRUCT-012` draft written for
[issue #2197](https://github.com/woojubb/robota/issues/2197) (the two presentation packages that
carry the transport prefix). Same family, same defect; the owner directed the whole-family refactor
rather than the two-package fix, and the earlier draft's measurements are reused in the paired spec.

## Objective

The owner's rule, verbatim (2026-09-05):

> "우리는 같은 레벨의 이름을 가진 패키지가 동레벨의 패키지를 import 하지 못하게 되어있습니다. 규칙이
> 그렇습니다. agent-transport의 하위 인 agent-transport-protocol은 다른 agent-transport-\*들이 평행
> 참조 불가합니다"

> "패키지 이름을 계층적으로 구성한 이유는 이렇게 쉽게 위반사항을 검출하기 위한 것입니다"

Measured on `develop` at `4b03d3248` over every workspace manifest (`dependencies` +
`peerDependencies`, enumerated without following symlinks): **six of the nine `agent-transport`
family members reach a sibling** — `-gui`, `-http`, `-webrtc`, `-webrtc-web`, `-ws` reach
`agent-transport-protocol`, and `-webrtc-web` also reaches `-gui`. `agent-transport-protocol` is a
sibling by name and the family's substrate by fact (its own manifest depends on six
`agent-interface-*` packages and on no transport). Nothing checks this: the sibling ban in
`scripts/harness/check-dependency-direction.mjs` exists for `dag-node-*` only (`:303-330`), and the
`agent-interface-*` peer rule reads a declared layer map.

The absorbed draft's conclusion is kept: this is a **declaration defect that shows up as a naming
defect** — 6 of 9 members declare `transport-admission: none`, the family's layers were never written
down, and every audit re-derives the same false positive by reading a prefix nothing enforces. The
owner's second ruling decides what the declaration is: **the name hierarchy itself.** So the fix is
not a layer table beside the names but a gate derived from the names, and names made true enough for
that gate to be green:

1. A name-derived family gate in `check-dependency-direction.mjs`: `agent-<family>-<child>` may depend
   on `agent-<family>` (its parent) and on packages outside the family (including
   `agent-framework` — the owner's correction: "agent-transport-\* 는 내부적으로 framework를 참조할 수
   있지"), never on `agent-<family>-<other-child>`. `agent-interface-*` stays delegated to the
   `ARCH-101` map. A prototype of the rule on the current tree is red on exactly 7 edges (the six
   above plus `agent-provider-openai → agent-provider-openai-compatible`), and green on parent edges
   in a three-family fixture (including the new `agent-ui-*` family); the output is in the paired spec.
2. The substrate is absorbed into the family parent — the owner: "agent-transport-xxx가 참고하려면
   agent-transport를 참고해야 합니다" — and `agent-transport-protocol` is removed. Before that can
   happen the parent must become importable by a browser bundle: it is purified first — the owner:
   "agent-transport 는 framework같은거 품지말고 순수할수록 좋다" — by moving `headless/`,
   `programmatic/`, the registry and the settings repository to `agent-framework` (the existing
   runtime-host layer), leaving `agent-interface-*` as its only workspace dependencies and no `node:`
   builtin outside a `./node` subpath.
3. The presentation packages leave the family as a new `agent-ui-*` family — the owner:
   "agent-ui-web / agent-ui-terminal, 둘 다 지금" — `agent-transport-gui` → `@robota-sdk/agent-ui-web`
   (`private: true`, 64 live files; the gate is red on `-webrtc-web → -gui` until it moves) and
   `agent-transport-tui` → `@robota-sdk/agent-ui-terminal` (published, 110 live files), both now.
4. The four `ws-`-named substrate modules stay in the parent and are renamed by what they are —
   the owner, shown that `-webrtc` and the neutral session bridge depend on them: "부모에 두고 의존
   기준으로 개명" — `wire-messages`, `session-message-handler` (`createSessionMessageHandler`),
   `session-events`, `background-messages`. The retired published names are deprecated with a pointer
   in the release run that ships their successors; no unpublish, no shim.

## Why it is not being solved elsewhere

- `INFRA-158` (a browser entry point for `agent-transport-protocol`) is the direction the owner
  abandoned — "현재 더이상 이방향으로 처리하지 말고" — because it would ship a browser subpath under a
  name the rule says may not be imported by its siblings at all.
- `ARCH-101` solved the `agent-interface-*` family with a declared layer table. The owner ruled that
  the transport family's declaration is its name hierarchy, so that shape is not reused here.
- `STRUCT-011` renamed one package out of the provider family; it supplies the rename procedure
  (live references rewritten, historical records left alone) and nothing else — its chosen naming
  class (`-defaults`/`-builtin`) is what the owner called "완벽한 모순".

## Approval boundary

Not covered by any standing authorization: a published package is removed
(`@robota-sdk/agent-transport-protocol`), the public surface of `@robota-sdk/agent-transport` and
`@robota-sdk/agent-framework` changes, and a repository-wide gate is added. The owner directed the
refactor and, on 2026-09-05, settled every decision inside it — the module placement, the
`agent-ui-web` / `agent-ui-terminal` names, the `agent-framework` `src/transport-host/` shape, the
registry leaving the parent, and the deprecate-with-pointer release step — each quoted verbatim in the
paired spec's `## Disposition`; its `## USER-DECISION` is empty. What remains is GATE-APPROVAL on the
plan as written.

## Out of scope — separate root items

Recorded, not absorbed:

- `agent-provider-openai → agent-provider-openai-compatible` — the same defect class in a family with
  no bare parent to absorb into; frozen in the S1 baseline pending its own root item.
- `agent-tool-defaults` — the refused naming class; already named by `STRUCT-011`'s completed record.
- A WebCrypto rewrite of `admission.ts` / `handoff-manifest.ts` — a `SEC-008` change, not a naming one.
- `agent-transport-webrtc-web` — a UI-family member (React components + hooks, deps `agent-ui-web` +
  `agent-remote-pairing`, no edge to `-webrtc`) left under a transport name after S4; filed as
  `.agents/tasks/STRUCT-013-agent-transport-webrtc-web-is-a-ui-family-member-under-a-transport-name.md`.

## Plan

- [x] S1 — add `checkFamilySiblings` to `check-dependency-direction.mjs` (parent legal, sibling
      illegal, `agent-interface-*` delegated, child → `agent-framework` not reported), freeze the
      seven measured edges in `scripts/harness/family-sibling-baseline.json`, add the three-family
      fixture (`agent-transport-*`, `agent-session-*`, `agent-ui-*`) and the two companion clauses
      (root never imports a child; `agent-framework`/`agent-core` never import a transport or UI
      child) plus the undeclared-import check; the `deps` scan stays green on the tree.
  - ST-4: clause (v) in `ARCHITECTURE.md` uses bare `agent-ui-*` (no `@robota-sdk/agent-ui` token before S4)
  - ST-9: the `FAMILY-SIBLINGS` sentence states its judged scope: `dependencies` + `peerDependencies`
  - TC-11: companion clauses (iv) parent → child and (v) `agent-framework`/`agent-core` → transport or UI child are reported on a fixture and green on the real tree
  - TC-12: the undeclared-import check reports a fixture `src/` import with no manifest entry in any of the three sections, and is green on the real tree
- [ ] S2 — purify `agent-transport`: move `headless/` (minus `print-terminal.ts` and `cli-input.ts`,
      which go to `agent-cli`, their only importer), `programmatic/`, `transport-registry*`,
      `transport-run-generation`, `transport-settings-*` to `agent-framework/src/transport-host/`;
      move `headless-host-action-parity.test.ts` and
      `headless-skill-activation.integration.test.ts` and `ws-multi-surface-exit-policy.test.ts` to the `agent-cli` suite (they import
      `agent-command`, which imports `agent-framework` — a `DEV-CYCLE` if placed in the framework);
      move both parent session-event-delivery example sources and their owner verification to `agent-cli` as clarified below; rewire `agent-cli` (8 files) and `examples/capabilities/multi-surface-deploy`; drop `agent-core`
      and `agent-framework` from the parent's manifest and the `./headless` export.
  - ST-1: `scan-transport-conformance` target set + `transport-conformance.tsconfig.json` + `scan-deployment-matrix` walk gain `packages/agent-framework/src/transport-host`; `headless` subject/row kept
  - ST-2: ARCH-005 `forbiddenIdentifiers` gain the moved transport symbols for `agent-product`/`agent-capability-pack`, with a fixture red-proof
  - ST-3: re-freeze `check-sdk-public-surface` count for `agent-transport`; move the three `no-fallback-swallow-baseline.json` keys and the `file-size-baseline.json` entry to the new paths; delete the two barrels `scan-public-project-authority` names
  - ST-5: the seven relative-import tests under `packages/agent-transport/src/__tests__/` move with the code
  - ST-8: docs that cite `agent-transport/headless` or `ProgrammaticInteractionChannel (in agent-transport)` are rewritten (`project-structure.md`, `content/guide/*`, `agent-cli`/`agent-interface-transport` SPECs, `agent-transport/README.md`, `deployment-matrix.md`); `check-doc-examples.mjs` mapping covers `./node`
- [ ] S3 — one unit, no shim (`checkPassthroughReexports` refuses an `export *` of a workspace
      package): move the 16 `agent-transport-protocol` modules into `agent-transport`
      (`admission.ts`, `handoff-manifest.ts` under `src/node/` behind a `./node` export declared
      `"browser": null`), rename the four `ws-` modules to `wire-messages`,
      `session-message-handler`, `session-events`, `background-messages`, rewire `-ws`, `-http`,
      `-webrtc`, `-gui`, `-webrtc-web`, `agent-cli` to `@robota-sdk/agent-transport` (`/node` where
      admission or the manifest is used), use public package imports for the CLI-owned test and delete its
      `-protocol` devDependency (else `checkFullGraphCycles` reports the pair), rewire the already CLI-owned
      `ws-multi-surface-exit-policy.test.ts` through public parent exports, fix the S3 rows of the spec's
      scans table, and remove the five `-protocol` baseline entries — about 104 live files.
  - ST-6: dead devDependencies `agent-transport-tui → agent-transport` and `agent-transport → agent-command` dropped with the `-protocol` one
  - ST-7: the undeclared-import check parses import declarations only (`^import` anchor), never JSDoc or template strings
- [ ] S4 — `git mv` `agent-transport-gui` → `agent-ui-web` and `agent-transport-tui` →
      `agent-ui-terminal` with `STRUCT-011`'s live/historical policy; rewrite the routing rows
      (`project-structure.md:29,78,325`, `publish-registry.md:54,67`, `harness.config.json:506,510`,
      `README.md:141`, `ARCHITECTURE.md:56`, `ci.yml:1322,1326`, guide and diagram lines), fix the S4
      rows of the spec's scans table, add `@robota-sdk/agent-ui-` to both ARCH-005
      `forbiddenDependencyPrefixes` lists in `.agents/harness.config.json` with a fixture red-proof
      (a product manifest declaring `agent-ui-terminal` must be a finding), and add the
      `agent-ui-*/` row.
  - ST-3: `scan-public-project-authority` `-tui` scope replaced
  - TC-13: ARCH-005 `forbiddenDependencyPrefixes` carry `@robota-sdk/agent-ui-` in both lists with a fixture red-proof, and the `:24` purity reason no longer names the retired packages
- [ ] S5 — delete `packages/agent-transport-protocol`, its routing-document rows, and the baseline
      file once it is empty; carry the two `npm deprecate` pointer commands from the spec's S5 into
      the owner's release checklist.

## Prospective S2 sequencing clarification — host tests and scenario ownership

This clarification preserves the approved final owners and behavior. It does not amend the
historical gates, mark S2 complete, absorb S3 substrate work, or change any runtime contract.
The parent loses `agent-core` and `agent-framework` from **every manifest dependency section**;
relocating them to devDependencies is not fulfillment, even if the narrower original TC-05 passes.
The seven family-baseline entries remain unchanged throughout S2.

**S2 test ownership.** Move `ws-multi-surface-exit-policy.test.ts` to
`packages/agent-cli/src/__tests__/` together with the already planned headless-host parity and
skill-activation tests. Its imports are already package specifiers, and CLI already declares
command, framework, protocol and the interface dependencies. Keep its real command/session
composition and assertions unchanged. S2 still imports `createWsHandler`,
`createOutboundDelivery` and `TServerMessage` from `agent-transport-protocol`.
S3 then only rewires this CLI-owned test to the public `agent-transport` exports and renamed
`createSessionMessageHandler`; the earlier instruction to internalise the parent test's import
does not apply after its S2 move. No cross-package relative source imports and no shim.

**S2 example ownership.** Move both
`packages/agent-transport/examples/verify-session-event-delivery.ts` and
`session-event-delivery-project-access.ts` to `packages/agent-cli/examples/`, retaining their
local helper relation, production trust-service path, deterministic provider, protocol imports
and scenario identifier `ARCH-020+ARCH-028-protocol`. This is a host-composition example, not a
framework-owned example: putting its protocol dependency in framework would violate the
companion family gate. S3 rewires only its public protocol package/symbol imports. Do not
delete assertions, alter runtime behavior, or replace execution with a recorded transcript.

The receiving CLI currently has no `scenario:verify`, `scenario:record`, or examples directory.
Its root typecheck includes `src/**/*` only. Add these owner-local scripts to its package manifest:

- `scenario:verify`: `pnpm exec tsx --conditions=source examples/verify-session-event-delivery.ts`
- `scenario:record`: `node ../../scripts/harness/record-owner-scenario.mjs --scope packages/agent-cli --output examples/scenarios/session-event-delivery.record.json -- pnpm scenario:verify`

Remove the old parent's matching scripts, and move/adapt its `tsconfig.examples.json` to CLI
(`rootDir: "."`, `noEmit: true`, `declaration: false`, `declarationMap: false`, includes both
`examples/**/*` and `src/**/*`, preserving applicable compiler/type-root settings). CLI
`typecheck` becomes `tsgo --noEmit && tsgo -p tsconfig.examples.json --noEmit`; the parent
drops the now-nonexistent examples-project leg, not checks of remaining owned sources.
Only drop parent dependency entries after a complete src/examples import inventory proves no
remaining consumers; do not satisfy purity through excluded files or undeclared imports.

**Historical record versus new owner evidence.** Move the old authoritative record, byte-for-byte,
to `.agents/archive/struct012-s2/agent-transport-session-event-delivery.record.json` as explicit
historical evidence outside the active `examples/scenarios/*.record.json` registry. Its SHA256 is
`7e154ebca8c66487094da32113cbcce49c76d6b2577e18c0a59665e28652400f`; keep its old scope,
packageName, command, Linux stdout and hashes unchanged. Do not copy it into CLI's live registry
and relabel its metadata. The owner map discovers package scripts automatically; no central
override/registry extension is needed. The validator requires exactly one active record per
resolved command and exact scope/command/output matching.

After the affected build, execute `pnpm --filter @robota-sdk/agent-cli scenario:verify`.
On a supported Linux checkout, require the same normalized structured scenario payload as the
historical record (plan events, context refresh, branch events/final branch, committed delivery
failure and cleanup), with no unexplained output difference. Only then run
`pnpm --filter @robota-sdk/agent-cli scenario:record` to create fresh CLI-owned evidence through
the existing recorder, and verify again with
`pnpm harness:verify -- --scope packages/agent-cli --include-scenarios` without
`--skip-record-check`. This planned recording establishes new execution/owner metadata, not
new behavior or permission to normalize a regression away. Preserve source/head/platform and
actual command transcripts for comparison.

The current macOS run can only exercise the example's existing ARCH-047
`notApplicable: true` branch. That is not a successful Linux scenario. Do not use its zero exit
to replace the historical success payload or manufacture a successful new CLI record. If no
supported Linux execution is available, report the missing new-owner execution/record comparison
as pending, keep S2 acceptance pending, and stop rather than invent evidence or change platform
policy. No previous successful run is reattributed to this checkout.

**Interim root and verification.** S2 may retain a valid empty `agent-transport/src/index.ts`
until S3 supplies substrate; remove obsolete headless/programmatic build entries and the
`./headless` export. No compatibility re-export or invented runtime behavior is introduced.
TC-05 keeps its existing commands and additionally checks all dependency sections for zero
core/framework entries and all remaining parent src/examples imports for zero such consumers.
TC-09 keeps its package suites and additionally requires all three CLI-moved tests collected,
CLI examples typechecked, the historical archive hash unchanged, and the new CLI owner scenario
record verified as above. These checks supplement, not replace, ST-1/2/3/5/8 and TC-10's normal
stage-end verification. All original failure/gate evidence remains historical.

## Test Plan

TC-01 is the load-bearing one and it is a fixture test over synthetic package maps — the shape
`scripts/harness/__tests__/check-dependency-direction.test.mjs` already uses — not an assertion that a
scan file exists. It plants a parent edge and a sibling edge in **two** families
(`agent-transport-*`, `agent-session-*`) plus a child → `agent-framework` edge, and asserts that
exactly the two sibling edges are reported: the parent-legal arm is the defect a path-derived rule is
documented to have (`dependency-cruiser`'s "also relations _within_ folders"), the framework arm is
the owner's correction, and a family resolving to zero members must be a finding rather than an empty
pass. TC-02 and TC-03 assert both directions of the baseline — an unlisted edge fails, a stale entry
fails — because a baseline that outlives its violation has quietly stopped guarding. TC-04 asserts the
four `agent-interface-*` edges are judged once, by `INTERFACE-DEPS`, before and after.

TC-05 and TC-06 are the parent's standing invariants and stay in the tree after this item: the
manifest names only `@robota-sdk/agent-interface-*`, no `agent-core`/`agent-framework` import in
`src/`, and no `node:` import reachable from the root barrel (only under `src/node/`, exported as
`./node`). TC-07 and TC-08 are the end-state checks (no baseline file, zero family findings; the
removed and renamed names absent from live files with the historical counts unchanged). TC-09 runs
the affected package suites and TC-10 `pnpm harness:verify-like-ci` at the end of **every** unit
S1–S5, not only the last — S2 in particular moves live `agent-cli` paths and must leave that suite
green before S3 begins. All ten are stated in command form in the paired spec.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No end user can observe a package rename, a moved module, or a dependency-direction
rule through any runnable surface; the CLI, the terminal UI and the browser monitor present the same
sessions, the same messages and the same commands before and after this item, and the only thing
that changes for a person is which package name they type in an import statement.
