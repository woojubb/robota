---
title: 'HARNESS-029: mechanical memory-neutrality floor for packages/'
status: todo
created: 2026-07-18
priority: medium
urgency: later
area: scripts/harness
depends_on: [SELFHOST-008]
---

# Mechanical memory-neutrality scan

Filed by SELFHOST-008 P1 (TC-06) per [enforcement-architecture.md](../rules/enforcement-architecture.md): every
guardian must be backed by a mechanical floor. The library-neutrality of the runtime memory subsystem is currently
a **manual grep/review** — no `pnpm harness:scan` rule fences it. `scan-memory-mirror.mjs` governs the DIFFERENT
`.agents/memory` harness mirror; `deps`/`interface-imports`/`interface-runtime` do not check content.

**What to fence:** no memory CONTENT (seeded `MEMORY.md`/`topics/*` corpus) and no app-voice curation
PROMPT/policy text under `packages/*/src`. Memory content must live only in the consumer workspace
(`<cwd>/.robota/memory/`); the capture prompt/policy must live in the surface (`agent-cli`/`apps/agent-app`).

**When it must gate:** the ENDORSE note on SELFHOST-008 scopes this to the slice that FIRST injects a curation
prompt / seeded content — i.e. **SELFHOST-008 P3/P4** (`ISemanticMemoryAdapter` wiring + a concrete backend/surface
policy), where the neutrality risk actually materializes. Not needed to gate P1 (which added only the neutral port

- fs reference adapter, no content/prompt).

**Shape (v1):** a `scan-memory-neutrality.mjs` over `packages/*/src` mirroring the `orchestration-neutrality`
scan — flag seeded memory-corpus files and high-confidence app-voice capture-prompt strings in the memory
subsystem; register in `run-all-scans.mjs`. Goes through the gate pipeline like any spec.
