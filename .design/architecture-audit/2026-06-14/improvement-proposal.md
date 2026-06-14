# Architecture Conformance — Improvement Proposal — 2026-06-14

Companion to `conformance-audit-report.md`. Maps the P1 findings to remediation backlogs and recommends a
mechanical guard so this class of drift is caught at the source next time.

## Root cause

The 3.0.0-beta.75 preset system (PRESET-001~017) + CTX-001 + HIST-001 were implemented through fully gated
PRs, but the **architecture-map documents and package SPECs were not updated alongside the code** — a
`three_doc_layers_sync` lapse. Only `project-structure.md` was updated (the preset dep edge). Result: 0 code
defects, but a single feature's documentation is missing across ~10 docs.

## Remediation backlogs (proposed)

### DOC-SYNC-001 (P1) — Document the preset layer across the architecture map

Covers AF-01, AF-10, AF-11. One backlog, doc-only:

- `agent-system.md`: add `agent-preset` node + `→ agent-framework` edge + `agent-cli/agent-command → agent-preset`; add a "named preset profiles / live preset switching" ownership row.
- `dependency-direction.md`: add `agent-preset` to the mermaid; fix `agent-subagent-runner → agent-core` and `agent-web-ui → agent-transport` omissions (AF-12).
- `repository-overview.md`: add `agent-preset` to the "Agent runtime and CLI" family list.
- `capability-placement.md`: add a preset owner-selection row (data=agent-preset, application=agent-framework, shell=selection-only).
- `cross-cutting-contracts.md`: add a "live preset application seams" contract row (`host-context.ts` preset seams + `preset/preset-application.ts`) + `agent-preset SPEC` landscape node.
- Refresh the `Source-verified … on <date>` stamps on `agent-cli-composition.md` / `transport-architecture.md`.

### DOC-SYNC-002 (P1) — Update package SPECs to the beta.75 surface

Covers AF-02, AF-03, AF-04, AF-05, AF-06, AF-07. Per-package SPEC edits (owner-knowledge policy — each
package owns its `docs/SPEC.md`):

- `agent-framework`: document the preset-application seam (`applyPresetToSession`, options/result types, host-context + runtime preset methods, `'self-verification'` section, `selectCommandModules`).
- `agent-command`: **fix the module count 19 → 21**, add `preset` + `schedule` rows, add the `@robota-sdk/agent-preset` dependency.
- `agent-preset`: add the external-loading surface (6 fns + 3 types); replace "future work (PRESET-007)" with the shipped loader contract (`~/.robota/presets`, per-file validation, built-in-collision rejection).
- `agent-cli`: add `@robota-sdk/agent-preset` dep, `--preset` flag, `selectPresetId`/`resolveCliPreset`, startup `loadExternalPresets()`.
- `agent-session`: add the preset methods + new `ISessionOptions` fields.
- `agent-core`: add `TModelEffort` SSOT + the `effort` channel (`IModelConfig`/`setModel`/`IChatOptions`, `'high'` default).

### DOC-FIX-001 (P1/P2) — Remove ghost package + refresh stale root diagram

Covers AF-08, AF-09:

- Remove the nonexistent `agent-team` from `ARCHITECTURE.md` and `repository-overview.md` (or move to an explicit "planned" note alongside `auth`/`credits`).
- Regenerate the `ARCHITECTURE.md` root ASCII box from `project-structure.md` (or replace it with a link) — 6 names are wrong/nonexistent.

## Guard recommendation (prevent recurrence)

The mechanical scans passed because they verify the **dependency graph** and **interface boundaries**, not
**SPEC ↔ exported-symbol coverage**. The drift that slipped through is "a package exports X but `docs/SPEC.md`
never mentions X" and "a doc names a package that does not exist."

Recommend (cheapest first):

1. **`ghost-package` check (low cost, high value):** extend an existing scan to fail when an architecture doc
   references an `@robota-sdk/<name>` or `packages/<name>` token that is not a real package (would have caught
   AF-08 mechanically). Mirrors the existing `workspace-package-name` guard, applied to docs.
2. **`spec-export-coverage` check (medium cost):** for each package, diff the public `src/index.ts` exported
   symbol names against tokens present in `docs/SPEC.md`; warn on exported-but-unmentioned symbols above a
   threshold. Catches AF-02/04/05/06/07 at the source. Start as a non-blocking `harness:scan` warning.
3. **Process:** add "update `docs/SPEC.md` + the relevant `architecture-map` doc" to the backlog **done gate**
   for any PR that changes a package's public `src/index.ts` (a `three_doc_layers_sync` reminder in
   `post-implementation-checklist`).

## Priority / sequencing

DOC-FIX-001 (ghost package — factually wrong, cheapest) → DOC-SYNC-002 (SPECs — the count VIOLATION + the
largest surface gap) → DOC-SYNC-001 (architecture-map graphs). The `ghost-package` guard (rec #1) is worth
landing with DOC-FIX-001 so the fix is enforced. All remediation is documentation-only — **no release
blocker**, no code change required.
