# SELFHOST-008 P6 — surface-wire memory into agent-cli + agent-run verification (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-008-P6-surface-wiring.md`](../spec-docs/active/SELFHOST-008-P6-surface-wiring.md)
(GATE-APPROVAL ENDORSE + owner "승인"). 3-package scope (agent-cli + agent-transport + agent-transport-tui). The neutral
`agent-framework` memory library + `buildRuntimeSession` are UNCHANGED. Commit per logical slice.

## Design (approved)

- **Default OFF (opt-in).** Resolve one `memory` switch: `settings.json` `memory.enabled` (SSOT) ← `--memory`/`--no-memory`
  ← `ROBOTA_MEMORY=1|0` env. When ON: inject `memoryStore = createFileSystemMemoryStore(cwd)`, `recallMemory = { budget }`,
  `automaticMemory = { policy, retrieval: budget }` (policy default `approval_required`; `memory.autoSave: true` → `auto_save`).
- Merge into the resolved `TInteractiveSessionOptions` at the **print / serve / TUI** construction sites; extend the two
  transport option interfaces (`IHeadlessInteractionChannelOptions`, TUI `renderApp`/`TuiInteractionChannel`) to forward
  the fields. `buildRuntimeSession` unchanged.
- Observability: existing `/memory` list/pending/approve + P3 `<recalled-memory>` block + a one-time enable notice.

## Slices (each green + committed)

1. **S1 — resolver.** `memory-enablement.ts` in agent-cli: settings/flag/env precedence (default off) →
   `{ memoryStore?, automaticMemory?, recallMemory? }` + a resolved `enabled`/`autoSave`. Unit tests TC-01/02/03.
2. **S2 — transport option pass-through.** Extend `IHeadlessInteractionChannelOptions` (agent-transport) + the TUI
   `renderApp`/`TuiInteractionChannel` option surface (agent-transport-tui) to carry + forward the memory fields into
   `buildRuntimeSession`.
3. **S3 — inject at the three sites.** print-mode (via the headless channel), serve-mode (`sessionOptions`), TUI
   construction (`cli.ts` renderApp). One-time enable notice.
4. **S4 — settings schema + flag + docs.** `--memory`/`--no-memory` arg parsing + `memory` settings entry + one-time
   notice; agent-cli `docs/SPEC.md`.
5. **S5 — AGENT-RUN e2e verification (the core deliverable).** `-p` print mode, real provider (keys per
   `[provider-keys-local-run]`): run A capture ("remember that this project is released with 'pnpm ship'") →
   (auto_save OR `/memory pending`+`/memory approve <id>`) → run B fresh session, paraphrased ("how do I release this
   project?") → assert the `<recalled-memory>` block / answer reflects `pnpm ship`. Capture evidence to
   `.agents/evals/scenarios/selfhost-008-memory-agent-run.md`. TC-04/05/07 + neutrality TC-06.

## Test Plan

- **Unit (agent-cli):** resolver default-off (TC-01), settings←flag←env precedence (TC-02), enabled⇒options injected (TC-03).
- **AGENT-RUN (the agent executes, evidence captured):** capture to `.robota/memory/` (TC-04); fresh-session paraphrased
  recall shows the fact (TC-05, headline); `/memory` lists the entry + one-time notice printed (TC-07).
- **Neutrality (TC-06):** `pnpm harness:scan` (memory-neutrality + dependency-direction) green; no memory
  content/prompt/SDK in `packages/`; library + `buildRuntimeSession` unchanged.
- **Regression:** `pnpm --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-transport-tui test`, `typecheck`, `lint`, `pnpm harness:scan`.
