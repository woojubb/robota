# Architecture Map Review — Senior Design Architect

Review date: 2026-05-18
Source branch: `develop` (and `refactor/arch-002-slim-agent-cli` where noted in documents)

## Executive Summary

The architecture map is mature and well-structured for an actively evolving monorepo. The layer model follows Ports & Adapters principles cleanly, layer ownership tables are specific and actionable, and the CLI-specific layering audit (CLI-AUDIT-001 through -023) shows a disciplined process of identifying and resolving boundary violations. Five concrete inaccuracies were found against actual `package.json` files, ranging from a phantom Mermaid edge to stale package names in a core rules document. None block the architecture from functioning, but two (D-01 and D-02) could mislead an agent making dependency decisions.

---

## Strengths

**Layer model coherence.** The Domain → Adapters/Services → Assembly → Transport/Product Shell direction is correctly applied in every diagram reviewed. The `agent-core` zero-dependency constraint is enforced and verified by actual `package.json` (`jssha` and `zod` are external; no `agent-*` workspace deps).

**Type-contract package isolation.** `agent-interface-transport` and `agent-interface-tui` are genuinely zero-dependency in practice (verified by `package.json` and source inspection). No production logic resides in them. Separating these from `agent-framework` correctly breaks a circular dependency between transport implementations and the assembly layer.

**Composition-root discipline.** The `agent-cli` product-shell constraint ("terminal rendering, input, ephemeral selection state, concrete local host adapters only") is consistently applied across all 23 audit items in `layering-audit.md`, each with PR/commit evidence. The audit evidence-policy ("may not be marked resolved without a verification artifact") is the right gatekeeping mechanism.

**Opt-in optional package pattern.** The `agent-subagent-runner` package correctly isolates child-process execution as an opt-in dependency. Its `package.json` confirms it depends on `agent-framework + agent-executor + agent-provider` and does NOT depend on `agent-command` or `agent-cli`, matching the rule in `dependency-direction.md` line 58.

**Bidirectional Transport ↔ Assembly edge is documented and explainable.** The `TransportShells ↔ Assembly` bidirectional edge is explicitly acknowledged and justified in `dependency-direction.md` lines 53–55. Verified by `agent-transport/package.json` which lists `@robota-sdk/agent-framework` as a production dependency.

**CLI audit loop.** The `layering-audit.md` file shows 23 numbered audit items, all resolved with commit hashes or PR numbers. This is an exemplary record of incremental boundary cleanup and serves as both a history and a future reference for the same class of problems.

---

## Issues Found

### Critical (blocks architectural integrity)

| ID  | File | Issue                                                                                          | Impact |
| --- | ---- | ---------------------------------------------------------------------------------------------- | ------ |
| —   | —    | No critical issues found. All layer boundaries verified against package.json files are intact. | —      |

### Major (significant gaps or inaccuracies)

| ID   | File                      | Issue                                                                                                                                                                                                                                                                                                                      | Impact                                                                                                                                                                                     |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-01 | `dependency-direction.md` | Mermaid edge `TypeContracts --> Domain` is inaccurate. Both `agent-interface-transport` and `agent-interface-tui` have **zero** runtime dependencies — they do not depend on `agent-core`. The table description also reads "no runtime deps **beyond** agent-core," implying agent-core is a dep.                         | An agent reading this diagram will believe the interface packages depend on agent-core and may incorrectly add agent-core as a runtime dependency when creating future interface packages. |
| D-02 | `dependency-direction.md` | Mermaid edge `Assembly --> Orchestration` is unverified. `agent-framework` (the primary Assembly package) does **not** depend on `agent-team` (the Orchestration package). Actual consumer of `agent-team` is `agent-playground` (Playground layer).                                                                       | Misleads dependency-direction decisions: an agent may add an assembly-to-orchestration dependency believing it is sanctioned by this diagram.                                              |
| D-03 | `dependency-direction.md` | Assembly node label reads `"agent-framework, apps/agent-server"` but omits `agent-command`. `capability-placement.md` explicitly places `agent-command` in the Assembly layer. `apps/agent-server` is a server application/deployment unit, not an SDK assembly package; its inclusion in the Assembly node is misleading. | Agents using this diagram to place new packages in the correct layer will under-classify `agent-command` and may over-extend Assembly semantics to server apps.                            |

### Minor (improvements)

| ID   | File                                                                   | Issue                                                                                                                                                                                                                                                                                                                                                                                                                | Impact                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01 | `code-quality.md` (Layered Assembly Architecture section, lines 48–82) | Uses stale package names throughout: `agent-runtime` (→ `agent-executor`), `agent-sessions` (→ `agent-session`), `agent-providers` (→ `agent-provider`), `agent-plugins` (→ `agent-plugin`), `agent-sdk` (→ `agent-framework`), `agent-command-*` (→ `agent-command`). The `class-interface-inventory.md` maintains an explicit old→current name map table but `code-quality.md` does not reference it.              | Agent reads of `code-quality.md` produce confusion when cross-referencing package names in the actual monorepo. Rules referencing `agent-sessions` or `agent-sdk` name non-existent packages. |
| M-02 | `.agents/project-structure.md`                                         | Line 25 under `apps/` reads `agent-web-ui/` but the actual directory is `apps/agent-web/`. (The npm package name `@robota-sdk/agent-web-ui` matches the package convention, but the directory name does not.) Separately, line 56 references `agent-transport-*` and `agent-provider-*` wildcard patterns that no longer exist; these were consolidated into single packages with subpath exports.                   | Agents following directory-path references will not find the directory. Stale wildcard patterns could cause harness or check scripts to glob incorrectly.                                     |
| M-03 | `composition-tree.md`                                                  | Line 50 reads `"createDefaultBackgroundTaskRunners()  (agent-executor)"`, implying `agent-cli` calls this function directly from `agent-executor`. In practice: (1) `agent-executor` is only a **devDependency** of `agent-cli`; (2) `cli.ts` calls `createAgentRuntime()` from `@robota-sdk/agent-framework`, which internally calls `createDefaultBackgroundTaskRunners`. The source attribution is one layer off. | Agents extending the startup composition will look for a direct `agent-cli → agent-executor` production edge that does not exist.                                                             |
| M-04 | `dependency-direction.md` vs `capability-placement.md`                 | `agent-subagent-runner` is classified as a separate "OptIn" layer in `dependency-direction.md` (its own Mermaid node), but `capability-placement.md` places it inside the "Services" subgraph alongside `agent-session` and `agent-executor`. The two documents must agree on which layer it belongs to.                                                                                                             | Inconsistent layer assignment causes ambiguity when applying "stop conditions" in `capability-placement.md` to opt-in runner decisions.                                                       |
| M-05 | `.agents/project-structure.md`                                         | Lists `packages/auth/` and `packages/credits/` at lines 5–6 of the directory tree. Neither directory exists in the filesystem. `capability-placement.md` correctly marks auth/credits as "TBD — packages not yet created," but `project-structure.md` presents them as current members.                                                                                                                              | Agents scanning the project structure will attempt to reference or import from non-existent packages.                                                                                         |

---

## Detailed Findings

### D-01: `TypeContracts --> Domain` edge is inaccurate

**File:** `.agents/specs/architecture-map/dependency-direction.md`, line 46 (Mermaid) and line 74 (table).

**Evidence:**

- `packages/agent-interface-transport/package.json`: `"dependencies": {}` — zero runtime dependencies.
- `packages/agent-interface-tui/package.json`: `"dependencies": {}` — zero runtime dependencies.
- Source inspection of `agent-interface-transport/src/transport-adapter.ts` and `transport-config.ts`: no imports from any package. All types are self-contained primitives or cross-file internal imports.
- Source inspection of `agent-interface-tui/src/command-interaction.ts`: no imports from any package.

**Claimed:** The Mermaid diagram shows `TypeContracts --> Domain`, and the table reads "no runtime deps beyond agent-core."

**Actual:** Both interface packages have zero runtime deps — not even `agent-core`. The phrase "beyond agent-core" misleadingly implies agent-core is currently a dependency.

**Why it matters:** A future `agent-interface-*` package author reading this diagram will believe agent-core is acceptable as a runtime dep. That may be correct for some future interface (if it needs core types), but the current architecture achieves full isolation with no deps at all. The diagram should state the achieved state accurately.

---

### D-02: `Assembly --> Orchestration` edge is unverified

**File:** `.agents/specs/architecture-map/dependency-direction.md`, line 40.

**Evidence:**

- `packages/agent-framework/package.json`: production deps are `agent-core`, `agent-interface-transport`, `agent-executor`, `agent-session`, `agent-tools`, `zod`. `agent-team` is absent.
- `packages/agent-command/package.json`: production deps are `agent-core`, `agent-framework`. `agent-team` is absent.
- `packages/agent-playground/package.json`: includes `@robota-sdk/agent-team` as a production dep. This is the **only** production consumer.

**Claimed:** `Assembly --> Orchestration` edge in the flowchart implies an Assembly-layer package consumes Orchestration (agent-team).

**Actual:** No Assembly-layer package depends on `agent-team`. The Playground layer (`agent-playground`) is the sole production consumer.

**Correction:** The edge should be `Playground --> Orchestration`. Additionally, the `agent-system.md` multi-agent orchestration section says agent-team "sits in the orchestration layer between assembly and domain — below `agent-framework` but above `agent-core`," which is positionally correct, but the diagram edge that says Assembly calls down into Orchestration is not verified by any `package.json`.

---

### D-03: Assembly node omits `agent-command`; includes `apps/agent-server` incorrectly

**File:** `.agents/specs/architecture-map/dependency-direction.md`, line 12.

**Node label:** `Assembly["Assembly/API layers\nagent-framework, apps/agent-server"]`

**Inconsistency with `capability-placement.md`:**

- `capability-placement.md` places both `agent-command` (CMD node) and `agent-framework` (FW node) in the `Assembly["Assembly Layer — behavior + contracts"]` subgraph.
- `dependency-direction.md` omits `agent-command` from the Assembly node and lists `apps/agent-server` instead.

**`apps/agent-server` classification:** `apps/agent-server/package.json` shows it depends on `agent-core`, `agent-playground`, and `agent-provider`. It is a Node runtime service deployed on Firebase Functions, not an SDK assembly package. It belongs to a Deployment/Application tier, not the SDK Assembly layer. The `apps-and-deployment.md` document correctly treats it as a deployment unit.

---

### M-01: Stale package names in `code-quality.md` Layered Assembly Architecture

**File:** `.agents/rules/code-quality.md`, lines 48–83.

**Stale names found:**

| Used in code-quality.md | Current package name             |
| ----------------------- | -------------------------------- |
| `agent-runtime`         | `agent-executor`                 |
| `agent-sessions`        | `agent-session`                  |
| `agent-providers`       | `agent-provider`                 |
| `agent-plugins`         | `agent-plugin`                   |
| `agent-sdk`             | `agent-framework`                |
| `agent-command-*`       | `agent-command` (single package) |

The `class-interface-inventory.md` maintains a dedicated "Package name map (old → current)" table for the same set of renames. The `code-quality.md` rules file is the authoritative rules source and is read independently, so it must be self-consistent.

Lines 70 and 72 also contain the stale names in rule text ("wired through `agent-sessions` or `agent-sdk`"; "wire in `agent-sdk`").

---

### M-02: `project-structure.md` directory name mismatch and stale wildcard patterns

**File:** `.agents/project-structure.md`, lines 25 and 56.

**Directory mismatch (line 25):**

- Doc says: `apps/agent-web-ui/` (under the `apps/` tree)
- Actual filesystem: `apps/agent-web/` (verified by `ls /Users/jungyoun/Documents/dev/robota/apps/`)
- The npm package name (`@robota-sdk/agent-web-ui`, from `apps/agent-web/package.json`) matches a convention, but the directory itself is `agent-web`.
- `apps-and-deployment.md` correctly uses `apps/agent-web` throughout.

**Stale wildcard patterns (line 56):**

> Implementation packages (`agent-transport-*`, `agent-provider-*`, etc.) depend on the corresponding `agent-interface-*` package, not on `agent-framework`, for interface types.

The wildcard patterns `agent-transport-*` and `agent-provider-*` refer to the former split-package naming scheme. Current reality: `agent-transport` (single package with subpath exports: `/tui`, `/headless`, `/ws`, `/http`, `/mcp`) and `agent-provider` (single package with subpath exports: `/anthropic`, `/openai`, `/gemini`, etc.).

---

### M-03: `composition-tree.md` attributes `createDefaultBackgroundTaskRunners()` to `agent-executor` as a direct CLI call

**File:** `.agents/specs/architecture-map/agent-cli/composition-tree.md`, line 50.

```text
|- createDefaultBackgroundTaskRunners()  (agent-executor)
```

**Evidence from source:**

- `packages/agent-cli/package.json`: `agent-executor` appears only in `devDependencies`, not in production `dependencies`.
- `packages/agent-cli/src/cli.ts` line 1: imports `createAgentRuntime` from `@robota-sdk/agent-framework`. No import of `createDefaultBackgroundTaskRunners`.
- `packages/agent-framework/src/runtime/agent-runtime.ts` lines 2 and 68: `createDefaultBackgroundTaskRunners` is imported from `agent-executor` and called internally within `createAgentRuntime`. It is not re-exported.

**Actual call chain:** `cli.ts → createAgentRuntime() [agent-framework] → createDefaultBackgroundTaskRunners() [agent-executor, internal]`.

The composition-tree annotation should read `createAgentRuntime() (agent-framework)` rather than attributing the internal call to the product shell's composition.

---

### M-04: Inconsistent layer classification for `agent-subagent-runner`

**Files:**

- `dependency-direction.md`: `agent-subagent-runner` is modeled as a standalone `OptIn` layer node separate from all other layers.
- `capability-placement.md`: `agent-subagent-runner` appears inside the `Services["Services — lifecycle state machines"]` subgraph alongside `agent-session` and `agent-executor`.

The two documents must agree. "OptIn" is a deployment/installation characteristic, not a layer classification. The correct layer placement is "Services" (or a variant like "Opt-in Runtime Services"), with the opt-in installation nature noted as a qualifier on that layer entry.

---

### M-05: `project-structure.md` lists non-existent `auth/` and `credits/` packages

**File:** `.agents/project-structure.md`, lines 5–6.

```text
├── auth/                        # Auth contracts, verifier ports, scope policy
├── credits/                     # Credit account, reservation, and settlement contracts
```

Neither `packages/auth/` nor `packages/credits/` exists in the filesystem (verified: `ls /Users/jungyoun/Documents/dev/robota/packages/` shows no match). `capability-placement.md` correctly marks these as "TBD — packages not yet created." The project-structure inventory should reflect the current state and mark planned packages clearly, not list them as existing entries.

---

## Recommendations

Listed by priority (highest first):

### Priority 1 — Correct inaccurate dependency edges (D-01, D-02)

**D-01:** Remove the `TypeContracts --> Domain` Mermaid edge from `dependency-direction.md`. Update the layer table row for "Type contracts" to read "Pure TypeScript interfaces, **zero** runtime deps" (remove the "beyond agent-core" qualifier). Update the inline description on line 18 from "no runtime deps" to "zero runtime deps — not even agent-core."

**D-02:** Change the `Assembly --> Orchestration` edge to `Playground --> Orchestration` in `dependency-direction.md`. Verify whether any assembly package is intended to call `agent-team` in the future; if so, document that as a planned edge with a TBD marker rather than a current fact.

### Priority 2 — Fix Assembly node label (D-03)

Add `agent-command` to the Assembly node label in `dependency-direction.md`. Remove `apps/agent-server` from the Assembly node and assign it to the ProductShells group (or create a separate Deployment group). Synchronize the Assembly layer definition between `dependency-direction.md` and `capability-placement.md` so both documents use the same package list.

### Priority 3 — Update stale package names in `code-quality.md` (M-01)

Replace all stale names in the "Layered Assembly Architecture" section of `code-quality.md` with current names. Optionally add a pointer to `class-interface-inventory.md`'s name map table for future reference. The rule text at lines 70 and 72 ("agent-sessions," "agent-sdk") must be updated as well since rules are normative documents.

### Priority 4 — Fix `project-structure.md` directory and wildcard inaccuracies (M-02, M-05)

- Change `apps/agent-web-ui/` to `apps/agent-web/` in the directory tree.
- Replace `agent-transport-*` and `agent-provider-*` wildcard patterns with the actual package names and a note about subpath exports.
- Mark `packages/auth/` and `packages/credits/` as `[planned]` or move them to a separate "Planned packages" section with a reference to `capability-placement.md`.

### Priority 5 — Correct `composition-tree.md` attribution (M-03)

Change line 50 of `composition-tree.md` from:

```
|- createDefaultBackgroundTaskRunners()  (agent-executor)
```

to:

```
|- createAgentRuntime()  (agent-framework)  [internally calls createDefaultBackgroundTaskRunners from agent-executor]
```

This preserves the educational context while correctly reflecting what `cli.ts` actually imports.

### Priority 6 — Reconcile `agent-subagent-runner` layer classification (M-04)

Choose one canonical layer for `agent-subagent-runner` and apply it consistently across `dependency-direction.md` and `capability-placement.md`. The recommended choice is to retain it inside the "Services" subgraph in `capability-placement.md` (already correct) and in `dependency-direction.md` replace the standalone `OptIn` node with a note inside the Runtime services layer row, marking it as "opt-in installation."

---

## Architectural Questions Not Yet Documented

The following questions arise from the review and are not answered in any reviewed document. They are offered as candidates for future architectural decisions:

1. **`ITuiCliAdapter` placement.** This interface is defined in `agent-transport/src/tui/tui-cli-adapter.ts` and depends on `agent-core` and `agent-framework` types. Because of these dependencies it cannot move to `agent-interface-tui` (which must remain zero-dependency). The architecture map does not explain this constraint or state where TUI-adapter contracts that need framework types should live. A brief ADR or note in `capability-placement.md` would prevent future agents from attempting to move this contract to the wrong package.

2. **`auth` and `credits` integration point.** `capability-placement.md` marks auth/credits as "TBD — policy lives in orchestrator layer for now." The orchestrator layer is not defined with the same precision as the other layers (no package owns it today). When these packages are created, their relationship to `agent-framework`, `agent-team`, and `apps/agent-server` will need an explicit diagram update in `dependency-direction.md` and `agent-system.md`.

3. **Playground dependency on `agent-team`.** `agent-playground` is the sole consumer of `agent-team`. The `agent-system.md` playground stack diagram does not show this edge (`Playground --> RemoteClient --> Core` and `Playground --> Core` and `Playground --> Providers`, but no `Playground --> Orchestration`). The diagram should be updated to include the `Playground --> agent-team` edge for accuracy.
