---
status: approved
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
      anthropic config with definition default model and `$ENV:ANTHROPIC_API_KEY` key
      reference, `source: 'env-default'`
- [ ] TC-02: multiple env keys set (`ANTHROPIC_API_KEY` + `OPENAI_API_KEY`) → anthropic wins
      (definition order)
- [ ] TC-03: settings profile present + env key set → settings profile wins (regression)
- [ ] TC-04: no profile + no recognized env key → existing "No provider configuration found"
      error unchanged (regression)
- [ ] TC-05: local-type definitions (gemma/qwen/deepseek) are never synthesized from env keys
      alone (baseURL requirement respected)
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

- [ ] `.agents/tasks/CLI-066.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

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
