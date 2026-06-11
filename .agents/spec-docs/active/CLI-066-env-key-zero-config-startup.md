---
status: in-progress
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-066: Env-var-only startup — honor the product's own zero-config promise

## Problem

The product's guidance promises env-var-only startup in two places (verified 2026-06-11 on
npm-installed `3.0.0-beta.73`, product verification L1/L3):

- `robota diagnose`: "Set ANTHROPIC_API_KEY or run: robota --configure"
- `robota init` non-TTY fallthrough: "Set your API key via environment variable instead:
  ANTHROPIC_API_KEY=<key> robota"

But with `ANTHROPIC_API_KEY` exported and no provider profile, `robota -p "..."` fails with
"No provider configuration found" (exit 1). The advertised zero-config path does not exist:
`resolveActiveProvider` (agent-framework `provider-merge.ts`) only consults settings
documents, never provider-definition defaults, even though every cloud definition already
carries `defaults.model` and `defaults.apiKey: "$ENV:<NAME>"` (e.g.
`anthropic/provider-definition.ts:34-37`).

## Architecture Review

### Affected Scope

- `packages/agent-framework` / `src/command-api/provider/provider-factory.ts` (and/or
  `provider-merge.ts`) — when no settings profile resolves, synthesize an in-memory profile
  from the first provider definition whose `defaults.apiKey` `$ENV:` reference resolves
- `packages/agent-framework` / `docs/SPEC.md` — resolution order contract
- `packages/agent-cli` / `docs/SPEC.md` — startup contract; "No provider configuration"
  error now means "no profile AND no recognized env key"
- `packages/agent-cli` / startup notice — one stderr line when running on an env-synthesized
  profile

### Alternatives Considered

1. **Definition-defaults fallback inside provider resolution (chosen).**
   - Pro: uses data that already exists (`defaults.model` + `defaults.apiKey` env reference
     per definition); deterministic priority = definition order (anthropic, openai, gemini,
     gemma, qwen, deepseek); zero persistence side effects; settings profiles always win, so
     existing users are unaffected.
   - Con: behavior depends on ambient env vars — must be announced via a startup notice line
     so users know which provider/model was auto-selected.
2. **Auto-write a settings profile on first env-key detection.**
   - Pro: subsequent runs are explicit and inspectable.
   - Con: a read path silently mutating user config violates least surprise; conflicts with
     `--no-session-persistence`-style expectations; harder to undo.
3. **Remove the env-var guidance from diagnose/init messages (no code path).**
   - Pro: smallest change.
   - Con: kills the zero-config onboarding that diagnose/init/welcome UX was built around
     (CLI-049/050 restored these flows precisely for first-run UX); a worse product, not a
     fixed one.

### Decision

Alternative 1. This is not a new contract — it makes the code honor the contract the product
already advertises. Priority on multiple set env keys = definition order with the selected
provider named in the startup notice (`Using anthropic (claude-…) via ANTHROPIC_API_KEY —
run robota --configure to persist a profile.`). Env access is injected (parameter defaulting
to `process.env`) for testability. Explicit non-goals: no persistence, no interactive
prompt change.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 정의 6종(anthropic/openai/gemini/gemma/qwen/deepseek) defaults
      확인: cloud 3종은 `$ENV:` apiKey + model 보유로 합성 가능, local 3종(gemma/qwen/
      deepseek)은 baseURL 필수라 env 키만으로 합성 불가 — `defaults.apiKey`가 `$ENV:`이고
      해당 env가 설정된 정의만 후보로 제한
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. In provider resolution (agent-framework): after settings-document resolution returns
   nothing, iterate `providerDefinitions` in order; for each definition where
   `defaults.apiKey` matches `$ENV:<NAME>` and `env[<NAME>]` is non-empty and
   `defaults.model` exists (and `defaults.baseURL` exists if the definition requires one),
   return a synthesized `IProviderConfig` from the definition defaults, flagged
   `source: 'env-default'` (typed field, SSOT in the config type) so callers can render the
   notice.
2. `agent-cli` startup: when the resolved config is env-synthesized, write the one-line
   notice to stderr (print mode) / terminal (TUI) — never the key value.
3. No settings file is written. Profile in settings always wins (resolution order:
   settings → env-default → error).
4. SPEC updates: framework resolution order; CLI startup contract and error meaning.

_Correction during implementation (within the approved Decision): the draft's sibling scan
misread the actual definition data. Verified against `packages/agent-provider/src/*/`
(2026-06-12): **openai has `defaults.model: undefined`** by deliberate policy (model
catalog status `unavailable` — "discovered live from GET /v1/models"), so it cannot be
synthesized; **gemma's `defaults.apiKey` is the literal `'lm-studio'`**, not an `$ENV:`
reference, so it is excluded by the candidate rule itself; **qwen and deepseek carry
complete defaults** (`$ENV:` apiKey reference + model + baseURL), so they ARE synthesizable
— their baseURL comes from their own defaults, not from the environment. The data-driven
candidate rule in Solution step 1 is unchanged; only the draft's expected membership list
was wrong. Synthesizable set: anthropic, gemini, qwen, deepseek. Excluded: openai (no
default model — `OPENAI_API_KEY` alone still gets the configure guidance), gemma (literal
key). TC-02/TC-05 reworded accordingly._

## Affected Files

- `packages/agent-framework/src/command-api/provider/provider-factory.ts`
- `packages/agent-framework/src/command-api/provider/provider-merge.ts` (if resolution lives
  here)
- `packages/agent-framework/src/command-api/provider/__tests__/`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-cli/src/cli.ts` (notice emission)
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: no settings profile + injected env `ANTHROPIC_API_KEY=x` → resolution returns
      anthropic config with definition default model, the key resolved from the injected
      env (profile-path parity — `resolveActiveProvider` also returns resolved keys via
      `normalizeProviderConfig`), `source: 'env-default'`, and the env var NAME carried in
      `sourceEnvVar` for the notice. _Corrected during implementation: the draft said the
      key "stays a `$ENV:` reference", but provider creation and the subagent runner
      factory consume resolved keys (verified by a real 401 from the literal reference
      string in the live scenario run); the env name moved to a dedicated typed field so
      the notice never touches the value._
- [ ] TC-02: multiple synthesizable env keys set (`ANTHROPIC_API_KEY` + `GEMINI_API_KEY`) →
      anthropic wins (definition order). _Reworded during implementation: the draft paired
      anthropic with openai, but openai is not synthesizable (no default model) — see the
      Solution correction note._
- [ ] TC-03: settings profile present + env key set → settings profile wins (regression)
- [ ] TC-04: no profile + no recognized env key → existing "No provider configuration found"
      error unchanged (regression)
- [ ] TC-05: definitions failing the candidate rule are never synthesized — gemma (literal
      non-`$ENV:` apiKey default) and openai (no default model) produce no synthesis even
      with their env vars set; qwen/deepseek synthesize using their own complete defaults
      (incl. baseURL). _Reworded during implementation per the Solution correction note: the
      draft's "local 3종 excluded" premise misread the definition data._
- [ ] TC-06: startup notice line printed exactly once when running on an env-synthesized
      profile, naming provider, model, and env var name — never the key value
- [ ] TC-07: framework + CLI SPEC.md document the resolution order
      settings → env-default → error

## Test Plan

Derived strategy (BEHAVIOR + cli/typescript): unit tests with injected env; integration for
the notice line.

| TC-ID | Test Type   | Tool / Approach                                                 | Notes                             |
| ----- | ----------- | --------------------------------------------------------------- | --------------------------------- |
| TC-01 | unit        | vitest — resolution fn with injected env map                    | env injected as param, no stubEnv |
| TC-02 | unit        | vitest — two env keys injected                                  |                                   |
| TC-03 | unit        | vitest — temp settings fixture + env                            |                                   |
| TC-04 | unit        | vitest — empty env map                                          |                                   |
| TC-05 | unit        | vitest — env key matching a local-type definition               |                                   |
| TC-06 | integration | vitest — startCli print path with stub provider, capture stderr |                                   |
| TC-07 | manual      | SPEC.md diff review                                             | doc change — reviewed in PR diff  |

## Tasks

- [x] `.agents/tasks/CLI-066.md` — 생성 완료 (T1~T8, TC-01~TC-07 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptom present (`robota -p "..."` fails with "No provider configuration found", exit 1, on `3.0.0-beta.73`); reproduction condition present (`ANTHROPIC_API_KEY` exported, no provider profile); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (6 definitions scanned — 3 cloud synthesizable, 3 local excluded for baseURL requirement); Alternatives Considered has 3 entries, each with pro and con; Decision references the driving trade-off (honor advertised contract vs. silent config mutation vs. removing the promise; ambient-env dependence mitigated by startup notice).
- Completion Criteria: all 7 items have TC-N prefixes (TC-01–TC-07); at least one criterion per sub-item (resolution, priority, regression x2, local exclusion, notice, SPEC docs); each uses observable behavior form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: section present; 7 rows match 7 TC-Ns in Completion Criteria (count matches); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-07) has a non-empty Notes entry explaining why automation is not applicable (doc change reviewed in PR diff).
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and empty at gate run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied "승인함" (verbatim) on 2026-06-11 to the agent's "## 설계안 요약 (승인 요청)" message that requested approval of exactly the four GATE-WRITE-passed specs (CLI-063/064/065/066) and stated "4건 승인해 주시면 GATE-APPROVAL → 구현(TDD) → PR 순서로 진행합니다."
- Direct, unambiguous, directed at this spec: the approval message summarized CLI-066's design decisions specifically (in-memory env-default profile synthesis from definition defaults in definition order, no persistence, settings profile always wins, one-line provider/model/env-var startup notice without key value, local-type definitions excluded) and flagged it as containing a product-direction decision ("제품 방향 결정 포함"); "승인함" confirms all four presented designs including this one — not a clarifying answer, not silence, not approval of a different item.
- No post-approval modification: frontmatter (`type: BEHAVIOR`, `tags: [cli, typescript]`) and Architecture Review content match what was summarized for approval; last Evidence Log entry before this gate is GATE-WRITE (2026-06-11); approval was given after spec content was authored and summarized.
- NON-COMPLIANCE trigger check: no implementation started before this gate — `.agents/tasks/CLI-066.md` does not exist; no uncommitted changes in `packages/agent-framework/src/command-api/provider/` or `packages/agent-cli/src/cli.ts`.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-06-12

**Status remains:** approved
**Failed criteria:**

- Tasks correspond to Completion Criteria: `.agents/tasks/CLI-066.md` exists (criterion 1 met) and its path is recorded in `## Tasks` (criterion 2 met); T1–T7 cover TC-01–TC-07 by label, but T5 and T2 contradict the approved spec content. T5 defines the exclusion rule as "no `$ENV:` apiKey default (gemma) or no default model (openai)", while TC-05 and the approved sibling scan state all three cloud definitions (anthropic/openai/gemini) carry `defaults.model` + `$ENV:` apiKey and only local-type definitions (gemma/qwen/deepseek) are excluded due to the baseURL requirement — T5 wrongly removes openai from the synthesizable set. T2 tests priority with "anthropic before gemini", while TC-02 specifies `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` with anthropic winning — consistent with T5's incorrect model rather than the spec. Implementing per the tasks file would fail TC-02/TC-05.
  **Required action:** Rewrite T2 and T5 in `.agents/tasks/CLI-066.md` to match TC-02 (anthropic + openai env keys, anthropic wins by definition order) and TC-05 (local-type definitions gemma/qwen/deepseek excluded — baseURL requirement; cloud definitions including openai remain candidates), then re-run GATE-IMPLEMENT.
- NON-COMPLIANCE trigger check: no implementation commits — working tree clean for `packages/agent-framework/src/command-api/provider/` and `packages/agent-cli/src/cli.ts`; latest commit on provider-factory/provider-merge is CLI-064 (#698, 847cf8991), which introduced `ProviderConfigError` as a dependency of this item, not CLI-066 work.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-12

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-066.md` exists with tasks T1–T8 and a Test Plan summary deferring to this spec's authoritative TC table.
- Tasks file path recorded: `## Tasks` section lists `.agents/tasks/CLI-066.md` (T1~T8, TC-01~TC-07 매핑).
- Tasks correspond to Completion Criteria (one task per TC-N): T1↔TC-01 (env-default synthesis, `source: 'env-default'`, `$ENV:` key reference); T2↔TC-02 (`ANTHROPIC_API_KEY` + `GEMINI_API_KEY`, anthropic wins by definition order — matches the reworded TC-02); T3↔TC-03 (settings profile wins); T4↔TC-04 (`ProviderConfigError` "No provider configuration found" unchanged); T5↔TC-05 (gemma literal-apiKey and openai no-default-model excluded; qwen/deepseek synthesize from complete defaults incl. baseURL — matches the reworded TC-05); T6↔TC-06 (one-line stderr notice, never the key value); T7↔TC-07 (framework + CLI SPEC resolution order); T8 is an additional verification/PR task beyond the TC minimum.
- Prior FAIL (2026-06-12) resolution verified: the spec's Solution correction note was checked against `packages/agent-provider/src/*/` source — openai `defaults` contains only `apiKey: '$ENV:OPENAI_API_KEY'` with no `model` (modelCatalog `status: 'unavailable'`, `openai/provider-definition.ts:30-37`); gemma `defaults.apiKey` is the literal `'lm-studio'` (not an `$ENV:` reference); qwen and deepseek both carry `$ENV:` apiKey reference + model + baseURL in `defaults` (`qwen/provider-definition.ts:77-81`, `deepseek/provider-definition.ts:43-47`); anthropic and gemini carry `$ENV:` apiKey + model; definition order in `default-provider-definitions.ts` is anthropic → openai → gemini → gemma → qwen → deepseek, so anthropic precedes gemini as TC-02/T2 assume. T2/T5 no longer contradict TC-02/TC-05 — both sides now state the same corrected membership.
- Approved Decision integrity: the candidate rule in Solution step 1 and the Decision (definition-defaults fallback, settings-first, no persistence, startup notice) are unchanged; only the draft's expected membership list was corrected via the documented italic correction note, with TC-02/TC-05 carrying inline rationale.
- NON-COMPLIANCE trigger check: no implementation commits — `git status` clean for `packages/agent-framework/src` and `packages/agent-cli/src`; latest commits touching the affected paths are CLI-065 (#699, f25ad91b5), CLI-064 (#698, 847cf8991), CLI-063 (#697, eedc2f9bc) — all prior items, no CLI-066 work started.
