---
title: 'ARCH-027: public product/pack composition fields have no exhaustive fold policy — providerOverride, pack id, title, and description can compile as silent no-ops'
status: todo
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-product, packages/agent-capability-pack
depends_on: []
---

# ARCH-027: composition contracts lack a total field policy

## Problem

Published product/pack composition contracts have no mechanically total classification that requires
every field to be consumed, surfaced, or explicitly rejected. Hand-written folds can therefore omit a
field while TypeScript still accepts the implementation and callers receive a silent no-op. The reported
`providerOverride` and pack `id` defects are two instances; pack `title` and `description` are also
declared for discovery/UX but have no reader or surfaced output.

The root defect is the absence of an exhaustive field policy at both composition folds. Repairing only
the two originally cited fields leaves the same omission class open for existing metadata and every
future contract addition.

## Evidence

- `packages/agent-product/src/product-profile.ts:67-68` — `providerOverride?: string` ("Active-provider
  override id (data)"). `assemble-product.ts:112-179` never reads it; it is not surfaced on
  `IAssembledProduct`; robota routes the override through `readProviderSettings(cwd, { providerOverride:
args.provider })` BEFORE building the profile (`agent-cli/src/cli.ts:262-265`), and
  `createRobotaProfile` never sets the field. Repo-wide: no reader. The SPEC's provider-resolution
  precedence (`docs/SPEC.md:122-125`) omits the field, so contract and SPEC disagree about the
  profile's own surface.
- `packages/agent-capability-pack/src/capability-pack-types.ts:29-30` — `id` documented as serving
  "duplicate-pack reporting". `merge-capability-packs.ts` never reads `pack.id`; `IRejectedCapability`
  (`:54-58`) carries no pack provenance; two packs with one id are undetected.
- `ICapabilityPack.title` and `.description` are documented as discovery/UX metadata but are read nowhere
  and do not appear on `IMergedCapabilities` or `IAssembledProduct`.
- Earlier ARCH-006/007/008 repairs found the same composition-fold omission class in tool ownership,
  command-module selection, and preset-registry threading. The fold needs a total contract-key floor,
  not another finite list of manual projections.

## Direction

Define mechanically exhaustive field policies for `IProductProfile` and `ICapabilityPack`; adding any
public key must fail until the fold classifies it as consumed, surfaced, or explicitly rejected. Back the
classification with behavior/type fixtures so a label cannot conceal an inert field.

Remove `IProductProfile.providerOverride`: the shell owns provider-name selection and passes already
resolved `providerSettings` into product composition. Preserve the existing shell override behavior and
record the published-contract removal with the required changeset. Make `ICapabilityPack.id` effective by
pre-scanning pack IDs in profile order before any bucket fold. First ID wins; a later duplicate (including
an empty pack) is rejected atomically and contributes no command, tool, or subagent, while following
unique packs still merge. Report this on a distinct `IRejectedCapabilityPack`/`rejectedPacks` channel.
Require `packId` on every individual capability collision, whether against the base or an earlier
accepted pack. Surface accepted pack metadata so `title` and `description` fulfill their discovery/UX
contract instead of remaining dead input. `assembleProduct` must project both accepted metadata and
`rejectedPacks` losslessly onto `IAssembledProduct`; the product fold may not re-drop values repaired at
the capability-pack boundary.

## Recommendation Gate

- 2026-08-16 — the first depth review found the two-field symptom scope foundational; after the Task
  absorbed exhaustive product/pack field policies and both folds, the revised verdict is `DEPTH: LOCAL`.
- 2026-08-16 — independent final review endorsed removal of the obsolete product override, atomic
  duplicate-pack rejection, complete provenance, accepted metadata, and lossless product projection.

REVIEW VERDICT: ENDORSE

## Test Plan

- Red-first type test asserts `providerOverride` is absent while CLI/shell override behavior remains.
- Red-first merge tests assert a later duplicate (including an empty pack) is rejected on the separate
  pack channel before bucket merging, none of its capabilities land, following unique packs do land, and
  base/earlier-pack capability collisions carry the rejected contributor's `packId`. Accepted pack
  metadata preserves `id`, `title`, and `description`.
- Product assembly tests assert accepted metadata and pack-level rejections survive unchanged on
  `IAssembledProduct`.
- Public-key exhaustiveness fixtures fail when either composition contract gains an unclassified field,
  and behavior tests cover every field classified as consumed or surfaced.
- `pnpm harness:verify -- --scope packages/agent-product` and `--scope packages/agent-capability-pack`
  green; one beta-line breaking changeset covers both public packages.

## User Execution Test Scenarios

### Scenario: public product assembly surfaces total pack composition results

- **Agent executability:** `agent-executable`. This is a deterministic, IO-free public-SDK example over
  `assembleProduct`; it requires no provider, live key, network service, browser, or TTY. This item is not
  N/A: accepted metadata, atomic duplicate-pack rejection, provenance, and `IAssembledProduct` output are
  runnable behavior of a published API a consumer calls. Only the type-only `providerOverride` removal is
  covered by engineering/type evidence.
- **Prerequisites:** Node.js 22.14.0 and workspace dependencies installed. This work authors
  `packages/agent-product/examples/verify-composition-contract.ts`, adds package scripts
  `scenario:verify:composition-contract` and aggregate `scenario:verify`, and adds owner
  `scenario:record` output at
  `packages/agent-product/examples/scenarios/composition-contract.record.json`. The fixture is constructed
  entirely in memory.
- **Command:**

  ```bash
  volta run --node 22.14.0 pnpm --dir packages/agent-product run scenario:verify:composition-contract
  ```

- **Expected observable:** exit code `0` and exactly one deterministic JSON object on stdout. It reports
  accepted pack metadata in profile order with preserved `id`, `title`, and `description`; a later pack
  with a duplicate pack id appears once in `rejectedPacks`; that duplicate's uniquely named command,
  tool, and subagent are all absent (atomic rejection); a following unique pack still merges; and every
  base/earlier-pack capability collision reports the rejected contributor's `packId`. The same accepted
  metadata and `rejectedPacks` objects are observed losslessly from `IAssembledProduct`. Any mismatch exits
  non-zero and writes a diagnostic to stderr rather than printing a success object.
- **Cleanup:** none required; the example is a pure in-memory fold and creates no files, sessions,
  processes, timers, or process-global registrations.
- **Evidence (fill after implementation):** record the exact exit code and stdout JSON, then regenerate
  the canonical record with
  `volta run --node 22.14.0 pnpm --dir packages/agent-product run scenario:record`.

## Scenario Plan Gate

- 2026-08-16 — author rejected the earlier N/A classification because the governing rule explicitly
  includes published APIs a consumer calls. One offline public `assembleProduct` example now covers the
  runtime field policies, atomicity, provenance, following-pack continuation, and lossless product
  projection; the removed compile-time field remains in the engineering plan. Invocation probing reached
  the package and failed closed with `ERR_PNPM_NO_SCRIPT`, so the package-owned example/scripts/record are
  explicit prerequisites inside this work unit.

SCENARIO DRAFTED: automatable | 1

- 2026-08-16 — independent PLAN guardian returned PASS for `public product assembly surfaces total pack
composition results`: the public-SDK scenario has complete prerequisites, exact invocation, deterministic
  observables, explicit cleanup, canonical owner evidence, and coverage of every endorsed runnable
  recommendation; the type-only removal remains correctly assigned to engineering evidence.

DONE-GATE-STAGE-1: PASS
