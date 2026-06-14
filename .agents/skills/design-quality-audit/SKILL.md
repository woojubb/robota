---
name: design-quality-audit
description: Repeatable deep design-quality audit — judges whether the design is *right* (layer boundaries, coupling/cohesion, responsibility placement, type SSOT, extension seams, anti-patterns) by reading the code directly, not by checking docs against code. Use on demand, after large feature/refactor work, or before a release when you want a quality pass beyond conformance.
---

# Design-Quality Audit

Repeatable orchestrator for a **design-quality** audit: it reads the code and asks "is this the
right design?" — not "does the doc match the code?". It produces severity-classified findings and
maps them to remediation backlogs. Codifies the methodology used in the 2026-06-14 design-quality
audit (DQ-01~DQ-17 → DQ-AUDIT-001~007) so it can run on demand instead of as a one-shot pass.

## Rule Anchor

- `AGENTS.md` > Document Discovery Policy + "prefer a mechanical check over adding more prose"
- `.agents/rules/code-quality.md` > type SSOT, no `any`, no fallback, "Proper architecture over cheap fixes"
- `.agents/project-structure.md` > dependency-direction + one-way deps (the structural truth)

## This Skill vs. architecture-conformance-audit

Two different axes — run both, do not conflate:

| Axis            | [architecture-conformance-audit](../architecture-conformance-audit/SKILL.md) | design-quality-audit (this)                                          |
| --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Question        | Does the **doc match the code**? (drift)                                     | Is the **design right**? (quality)                                   |
| Source of truth | Architecture docs / SPEC.md claims                                           | Engineering judgement against rules + structure                      |
| Typical finding | "doc says X, code does Y" (STALE/DRIFT/VIOLATION)                            | "this type has two owners" / "this package is a kitchen-sink barrel" |
| Output          | INFRA-002 conformance report                                                 | DQ findings report + remediation backlogs                            |

`design-quality-audit` does **not** verify doc claims, run conformance gates, or restate
dependency rules — those are the conformance skill's job.

## When to Use

- After large feature or refactor work, or before a `develop → main` release.
- On demand when you suspect coupling/responsibility drift the conformance audit won't catch.

## Audit Axes (checklist)

Read the code directly and judge each axis. Capture every issue as a finding.

1. **Layer boundaries** — upward/reverse dependencies, layer-skipping, leaked concrete I/O across a port.
2. **Coupling & cohesion** — kitchen-sink barrels, packages mixing unrelated concerns, god classes/files.
3. **Responsibility placement** — logic in a thin shell that belongs in a domain package (and vice versa).
4. **Type SSOT** — the same data modeled by two independent types; duplicated record/config shapes;
   extension by copy instead of `extends`/`Pick`.
5. **Extension seams** — hardcoded behavior where a plugin/event/strategy seam belongs; missing
   composition root wiring.
6. **Anti-patterns** — `fallback`/silent defaults, vendor/product-name literals, raw `throw new Error`
   where a typed error exists, swallowed errors (`.catch(() => {})`), stub metrics (`return 0 // TODO`),
   dead/deprecated code, double APIs on one interface.

## Steps

1. **Mechanical baseline.** Run `pnpm harness:scan`. The existing guards (orphan-exports,
   interface-imports, capability-placement, dependency-direction, stub-markers, harness-config-paths)
   are the deterministic floor — start from a clean scan.
2. **Per-axis read.** Sweep the codebase against each Audit Axis above. Enumerate packages
   mechanically (`ls packages/*/`); do not hand-pick. Record which packages were covered.
3. **Classify.** Assign each finding a severity (P0 blocker / P1 / P2 / NIT) and a short id (`DQ-NN`).
4. **Map to backlogs.** Group findings by theme into remediation backlogs (spec-before-code; the
   architecturally-correct fix, not the cheapest — see code-quality "Proper architecture over cheap
   fixes"). Direct rule violations may be fixed immediately; larger relocations get their own backlog.
5. **Report.** Write findings + counts to `.design/architecture-audit/<date>/design-quality-audit.md`.

## Relocation Sweep (when remediation moves code)

When a finding's fix **relocates** code (split a package, move a responsibility), the move is not
done until every downstream reference is swept — code moves silently leave ghosts:

- backlog `## Affected Files` and Evidence Log path references,
- `packages/*/docs/SPEC.md` source-path references,
- **hardcoded paths inside harness scan scripts** (`scripts/harness/*.mjs`),
- `interface-imports` / capability-placement patterns that named the old location.

Re-run `pnpm harness:scan` after the move; `check-harness-config-paths`, `check-spec-paths`, and
`check-done-evidence` catch the ghost-path classes. Incident: DQ-AUDIT-004/005 relocations left
stale tui paths + ghost SPEC paths that failed several scans (2026-06-14).

## Output

One report under `.design/architecture-audit/<date>/design-quality-audit.md` (findings + severity
counts) plus remediation backlogs in `.agents/backlog/`. Reference exemplar:
`.design/architecture-audit/2026-06-14/design-quality-audit.md` → DQ-AUDIT-001~007.

## What This Skill Does NOT Do

- Verify doc-vs-code claims → that is `architecture-conformance-audit`.
- Run gates or decide PASS/FAIL → that is `backlog-gate-guard`.
- Fix findings inline → fixes are spun out as backlogs (spec-before-code).
