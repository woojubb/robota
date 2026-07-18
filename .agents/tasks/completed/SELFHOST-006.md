# SELFHOST-006 — per-role model routing (v1) — DONE

Spec: [`.agents/spec-docs/done/SELFHOST-006-per-role-model-routing.md`](../../spec-docs/done/SELFHOST-006-per-role-model-routing.md)
GATE-APPROVAL: PASSED (iteration 3 ENDORSE). GATE-IMPLEMENT + VERIFY + COMPLETE (v1): done.

## v1 (all DONE)

- [x] **agent-core contract (TC-01/05).** `TModelRef = { provider, model }` + `TRoleModelMap =
  Record<string, TModelRef[]>` — type-only, opaque string keys (no enum, no fixed
      planner|editor|reviewer union), ordered fallback chain (primary first).
- [x] **agent-framework policy (TC-01/02/04).** `resolveRoleModel` / `resolveRoleFallbackChain` /
      `runWithRoleFallback` — pure; `runWithRoleFallback` walks the chain via an injected `run()` over
      the provider DIP (no provider→provider edge; alternate provider+model on error).
- [x] **agent-provider-defaults (TC-05).** `DEFAULT_ROLE_MODELS` — concrete planner/editor/reviewer set
      (app-workflow opinion at the default layer, not the neutral contract).
- [x] **subagent resolution site (TC-03).** `create-subagent-session` resolves the model from the role
      map (opaque key = `agentDefinition.role ?? name`); precedence alias > role-map > parent.
- [x] **TC-04 dependency direction** — `check-dependency-direction` scan (54/54).

## Verification (AGENT-RUN)

agent-core + agent-framework 1154 (policy 7 + subagent 27) + agent-provider-defaults 6 + typecheck +
build + lint (0 errors) + `harness:scan` 54/54, all green.

## Deferred (future follow-ups, per approved scope)

- **P2** — main-loop per-turn role signal (the interactive turn loop has no role/phase signal today).
- **P3** — budget-based fallback (needs cost accounting; SELFHOST-004 now provides it).
