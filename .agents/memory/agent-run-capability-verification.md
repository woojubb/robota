# Agent-run verification for capability features (no library-seam N/A dodge)

**Principle (owner directive 2026-07-18).** A user-facing CAPABILITY feature (memory, retrieval, a new tool/mode) is
NOT done on unit/functional tests alone. Its spec/backlog **PLAN must include, from the start**: (1) the feature is
**reachable via a product surface** (a surface actually enables/injects the seam), and (2) an **AGENT-RUN end-to-end
user-execution verification the AGENT performs itself** — the agent drives the real product surface with a real
provider, exercises the capability end-to-end, captures evidence. The agent never delegates this run to the owner.

**Why.** SELFHOST-008 shipped P2 (capture) / P3 (recall) / P4 (semantic) as neutral **library seams**, each unit-tested
with fake providers and marked done — but NO surface (`agent-cli`/`apps`) set `automaticMemory`/`recallMemory`/
`memoryStore`, so the memory pipeline was **OFF in the real agent** and never agent-run-verified. A library seam no
surface enables was silently dodging the user-execution gate as "N/A (no runnable user-facing behavior)."

**How to apply.** Enforced in [backlog-execution.md](../rules/backlog-execution.md) → "Capability Reachability — no
library-seam N/A dodge": an intermediate library-only slice records engineering evidence and NAMES the pending
agent-run verification; it must not claim the capability done, and the epic is not COMPLETE until the agent-run
verification passes. Concrete open fix: `.agents/backlog/SELFHOST-008-P6-surface-wiring-and-agent-run-verification.md`
(wire memory into agent-cli + agent-run capture→recall e2e). Extends [[gui-verification-agent-owned]] and
[[user-execution-scenario-evidence]]. Mechanization deferred (reachability is semantic) → tracked HARNESS backlog item.
