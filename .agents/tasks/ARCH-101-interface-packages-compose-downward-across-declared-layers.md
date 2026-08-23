---
title: 'ARCH-101: interface packages compose downward across declared layers'
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: .agents/project-structure.md, .agents/specs, scripts/harness
depends_on: []
---

# ARCH-101: interface packages compose downward across declared layers

Registered as GitHub issue https://github.com/woojubb/robota/issues/2180.
Unblocks issues #2108–#2113 under tracker issue #2068.

## Problem

The Interface Package Rule restricts an `agent-interface-*` package's internal dependencies to a
subset of `{agent-core}`, and `checkInterfacePackageDeps` enforces that literally. The contract-family
owner map merged by ARCH-100 requires interface→interface edges, so the decomposition cannot start.

The owner has ruled that the general layer rule governs `agent-interface-*` as well: a package may
compose another with the same prefix **when the layers differ and the composition is one-directional**;
only **same-layer** dependencies are forbidden.

That makes the merged target graph legal. It does not make it buildable: **no guard implements the
ruling.** `checkInterfacePackageDeps` still refuses every interface→interface edge, so issue #2109
goes red on its first push — `agent-interface-transport` retains `session-contracts` until
issue #2110 and must depend on `agent-interface-execution`.

## Existing Evidence

Measured on `origin/develop`.

- Cross-family module edges, after the pass-through correction: `mobility → session` (2 symbols),
  `session → command` (4), `session → execution` (20). All strictly downward; **zero same-layer edges**.
- The one upward edge is `workspace-contracts → session-contracts`, the accidental re-export that is
  already the first precondition of issue #2109.
- `check-dependency-direction.mjs:232-246` fails any `@robota-sdk/*` dependency other than
  `agent-core`, unchanged.
- The layers are declared in `.agents/specs/contract-family-owner-map.md` as a fenced diagram —
  description, not data. Nothing reads them.
- `interface-family-owner` proves the module graph is acyclic. **Acyclic no longer implies legal**: a
  same-layer edge can be perfectly acyclic.

## Directions Considered

- Make the layer declaration machine-readable in the map and have both guards read it through one
  shared parser (chosen).
- Hard-code the layer assignment in each guard. Rejected: two copies of one fact, which is the drift
  this repository keeps paying for.
- Relax `checkInterfacePackageDeps` to allow any interface→interface edge and rely on
  `checkFullGraphCycles`. Rejected: acyclicity does not forbid a same-layer edge, so the ruling would
  be unenforced.

## Completion Criteria

- [ ] The Interface Package Rule states the layer ruling: downward one-directional composition is
      permitted, same-layer and upward are refused.
- [ ] The layer assignment is machine-readable, with one owner and one parser.
- [ ] `checkInterfacePackageDeps` permits a downward interface→interface manifest edge and refuses a
      same-layer or upward one.
- [ ] `interface-family-owner` refuses a same-layer or upward module edge, not only a cycle.
- [ ] Each new refusal is demonstrated red before the code that satisfies it.
- [ ] `pnpm harness:scan` exit 0.

## Test Plan

- Unit tests over the shared layer parser and both guards' new predicates.
- Falsification: a same-layer edge and an upward edge each flip a verdict that acyclicity alone passes.
- Full harness scan and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

This task delivers no user-facing behavior: it amends a rule and two repository verification scans, and
moves no production TypeScript. The verification surface is the harness gate, recorded in the Test Plan.
