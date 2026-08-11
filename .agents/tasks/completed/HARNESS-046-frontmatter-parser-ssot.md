---
title: 'HARNESS-046: converge harness frontmatter parsing on one SSOT parser'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: medium
urgency: soon
area: scripts/harness
depends_on: [HARNESS-044]
---

# HARNESS-046: one frontmatter parser, not four

## Outcome (DONE 2026-07-25)

`scripts/harness/frontmatter.mjs` is now the single owner of harness frontmatter parsing, and every
harness frontmatter reader imports it. Four hand-rolled regexes were deleted:

| Script                             | Deleted fork                  | Defect it carried                                                                                             |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `check-spec-doc-frontmatter.mjs`   | `^([A-Za-z_][A-Za-z0-9_-]*):` | none (it WAS the HARNESS-044 fix — its parser moved out of the gate and into the shared module)               |
| `scan-capability-reachability.mjs` | `^([A-Za-z_]+):\s*(.*)$`      | a wrapped `user_execution:` / `user_execution_scenario:` value read as `''` → false "dodged the gate" failure |
| `check-agent-def-convention.mjs`   | `^([A-Za-z0-9_-]+):\s?(.*)$`  | a prettier-wrapped `tools:` flow array read as `''` → the read-only/edit-tool check goes BLIND                |
| `scan-orchestration-map.mjs`       | `/^name:\s*(\S+)\s*$/m`       | not anchored to the `---` block, so a `name:` in the BODY became the agent identity                           |

A fifth fork, `check-backlog-placement.mjs`, is **allowlisted, not converted**: it reads only the
`status`/`completed` scalars (which prettier never reflows, so it is latent rather than live) and the
file was under concurrent edit when this landed. The allowlist entry carries that reason, and the
floor fails on a reason-less entry.

**Home decision.** Not `check-spec-doc-frontmatter.mjs` (a policy gate with its own `main()`/exit
code — four scans depending on a gate inverts the dependency direction) and not `shared.mjs` (the
656-line verify-pipeline module: git, `spawnSync`, workspace scopes, `WORKSPACE_ROOT = process.cwd()`
— a leaf scan should not drag that in to read a `---` block, and it is near the file-size ratchet).
A dedicated single-responsibility module also gives the anti-fork floor a one-file allowlist.

**The mechanical floor** is `scripts/harness/__tests__/frontmatter-parser-ssot.test.mjs` (run by
`pnpm harness:test`, which CI's `scans` job runs): it extracts every regex literal from every harness
script and fails when one reads a frontmatter key outside `frontmatter.mjs`. Proven red by planting
`/^([A-Za-z_]+):\s*(.*)$/` in a scan (1 failed) and green once removed (10 passed). A test rather
than a scan, so no `harness.config.json` / `run-all-scans.mjs` registration is required.

Red-first per converged scan, each driven END-TO-END through the scan's own entry point (not through
the parser directly, so the reds survive future refactors): 11 failures before conversion, 66 passes
after. The `tools:` wrapping fixture is byte-exact prettier output, not hand-written. No check was
weakened — empty `tools: []`, a genuinely dodged capability gate, and a missing scenario path all
still fail, now via wrapped-frontmatter fixtures too.

Differential over the real corpora (every `.claude/agents/*.md` frontmatter key + body, and every
`.agents/spec-docs/done/*.md` capability key), old parser vs new: **0 diffs** — the change is purely
additive on today's files, exactly as HARNESS-044's was.

## Problem

HARNESS-044 (#1380) fixed `check-spec-doc-frontmatter.mjs` to read prettier-wrapped multi-line YAML
arrays and exported a reusable `parseFrontmatterBlock`. But the same single-line-only assumption is
**forked into other harness scans**, each with its own hand-rolled regex:

- `scan-capability-reachability.mjs` (`parseFrontmatter`)
- `check-agent-def-convention.mjs` (`parseAgentFile`)
- `check-backlog-placement.mjs` (reads only `status`/`completed` — safe today)

Those are **latent, not live**: they read short scalars, and prettier reflows only `[...]` flow
arrays, which those files currently lack. But the hazard is real and armed — `.agents/tasks/`
already carries **441 `depends_on: [`** and **24 `related: [`** flow arrays, so the day any scan
reads one of those fields, it silently mis-parses exactly as #1369 did.

Root class (per the recurring-mistake-prevention principle): the same parsing truth is duplicated
per-scan, so a fix in one place leaves the others broken. Fixing the instance does not close it.

## What

Converge every harness frontmatter reader on the single exported `parseFrontmatterBlock` SSOT from
`check-spec-doc-frontmatter.mjs` (or lift it into `scripts/harness/shared.mjs` if that is the better
home — decide when implementing, one owner module either way). Delete the forked regexes. Then add
the mechanical floor: a test (or scan) asserting no harness script hand-rolls a
`^<key>:\s*(.+)$`-style frontmatter regex outside the SSOT module.

## Test Plan

Red-first per converged scan: a fixture with a prettier-wrapped array in the field that scan reads
must FAIL before conversion and PASS after. The anti-fork floor must FAIL when a hand-rolled
frontmatter regex is planted in a harness script, then PASS once removed. `pnpm harness:test` +
`run-all-scans` green.
