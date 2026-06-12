---
status: in-progress
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-067: diagnose accuracy — agree with runtime resolution, validate both settings levels, non-zero exit on issues

## Problem

Verified 2026-06-11 (L1, npm-installed `3.0.0-beta.73`):

1. With a configured provider profile whose `apiKey: "$ENV:NAME"` resolves at session start
   (a real API call succeeded in the same environment), `robota diagnose` still prints
   `✗ API key: No API key found`. `checkApiKey()`
   (`packages/agent-cli/src/startup/diagnose-command.ts:47-65`) inspects only five hardcoded
   env var names (ANTHROPIC/OPENAI/GEMINI/DEEPSEEK/DASHSCOPE_API_KEY) and never consults
   settings profiles — diagnose disagrees with the runtime's own provider resolution
   (settings → env-default, CLI-066).
2. `checkSettingsFile(cwd)` (`diagnose-command.ts:77-105`) validates the project
   `.robota/settings.json`, and falls back to `$HOME/.robota/settings.json` only when the
   project file is absent — a corrupt user-level file alongside a valid project file passes
   unflagged (related: CLI-069).
3. `runDiagnoseCommand` (`diagnose-command.ts:173-215`) returns void and the `cli.ts:90-93`
   dispatch just returns — `robota diagnose` exits 0 even after printing
   `✗ N issue(s) found`, so it cannot gate CI or scripts.

## Architecture Review

### Affected Scope

- `packages/agent-cli` / `src/startup/diagnose-command.ts` — API-key check mirrors runtime
  resolution; settings check covers BOTH levels; command returns an issue count
- `packages/agent-cli` / `src/cli.ts` — dispatch maps issue count to exit code
- `packages/agent-cli` / `docs/SPEC.md` — diagnose contract (checks performed + exit-code
  policy)
- Read-only reuse of `packages/agent-framework` provider resolution
  (`readProviderSettings` / `resolveEnvDefaultProvider`) — no framework changes

### Alternatives Considered

1. **Reuse the framework's actual resolution functions inside diagnose (chosen).**
   - Pro: diagnose can never disagree with the runtime again — same code path, same
     answer; env-default synthesis (CLI-066) and profile `$ENV:` resolution come for free;
     zero duplicated provider knowledge in the CLI.
   - Con: diagnose output becomes resolution-shaped ("provider X resolvable via …") rather
     than a raw env-var inventory — the message texts must be reworded.
2. **Extend the hardcoded env list and add a parallel profile check inside diagnose.**
   - Pro: localized change, keeps current message structure.
   - Con: a second implementation of resolution logic — the exact drift that caused this
     bug; every future resolution change (new provider, new source) re-breaks diagnose
     silently.
3. **Exit-code: keep exit 0 always, print-only diagnostics.**
   - Pro: no behavior change for existing scripts.
   - Con: defeats the point of a diagnostic command in CI; the backlog's verified pain is
     exactly that issues are invisible to scripts. Rejected.

### Decision

Alternative 1, with exit policy: **0 = no issues, 1 = one or more issues found** (single
non-zero code — diagnose reports many heterogeneous checks; per-category codes add contract
surface with no consumer). The driving trade-off is single-source-of-truth resolution vs
message-shape stability: SSOT wins because the bug class is drift between two
implementations. Both settings levels are always checked independently (user-level AND
project-level, each reported), removing the either/or fallback in `checkSettingsFile`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `diagnose-command.ts` 전체 체크 함수 5종(checkNodeVersion,
      checkApiKey, checkSettingsFile, checkSessionDir, checkNetwork) 확인: API-key/settings
      2종만 본 건 대상, 나머지는 무변경; `cli.ts:90-93` dispatch가 exit code를 버리는 것
      확인; framework `readProviderSettings`는 `env` 주입 옵션을 이미 노출(CLI-066) —
      diagnose에서 테스트 주입 가능
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `checkApiKey` → `checkProviderResolution`: call the framework resolution
   (`readProviderSettings` with injected env, then `resolveEnvDefaultProvider` fallback —
   identical order to session start). Report ✓ with the resolved provider/source
   (`profile "name"` or `env-default via VAR`); report ✗ only when the runtime itself would
   fail, reusing its guidance. Never print key values.
2. `checkSettingsFile` → check user-level and project-level independently: each existing
   file must parse (✗ names the file path + parse error); a missing file is reported as
   info, not an issue.
3. `runDiagnoseCommand` returns the issue count; `cli.ts` sets `process.exitCode = count
   > 0 ? 1 : 0`.
4. `docs/SPEC.md`: diagnose section documents the checks and the 0/1 exit contract.

## Affected Files

- `packages/agent-cli/src/startup/diagnose-command.ts`
- `packages/agent-cli/src/startup/__tests__/diagnose-command.test.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: profile with resolvable `$ENV:` reference (env injected) and no bare provider
      env keys → API-key/provider check reports ✓ naming the profile; exit 0
- [ ] TC-02: no profile + recognized env key (e.g. injected `ANTHROPIC_API_KEY`) → check
      reports ✓ naming env-default source — diagnose agrees with CLI-066 runtime synthesis
- [ ] TC-03: no profile + no recognized env key → check reports ✗ with the same guidance the
      runtime error gives; `robota diagnose; echo $?` → 1
- [ ] TC-04: corrupt user-level `~/.robota/settings.json` (isolated HOME) alongside a valid
      project file → user-level file flagged as invalid JSON with its path; exit 1
- [ ] TC-05: all checks pass → exit 0; any issue → exit 1 (exit-code matrix test)
- [ ] TC-06: no key value ever appears in diagnose output (assertion over full output with a
      known key in env)
- [ ] TC-07: `packages/agent-cli/docs/SPEC.md` documents the diagnose checks and the 0/1
      exit-code contract

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                | Notes                                                                 |
| ----- | --------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | unit      | vitest — diagnose with temp settings fixture + injected env    | profile `$ENV:` resolution ✓                                          |
| TC-02 | unit      | vitest — injected env only, no settings                        | env-default agreement                                                 |
| TC-03 | unit      | vitest — empty env, no settings; assert issue + returned count | exit mapping unit-level                                               |
| TC-04 | unit      | vitest — corrupt JSON fixture at isolated user level           | path named in output                                                  |
| TC-05 | unit      | vitest — issue-count → exit-code mapping both directions       | includes cli.ts dispatch path                                         |
| TC-06 | unit      | vitest — output scan for the injected key value                | security assertion                                                    |
| TC-07 | manual    | SPEC.md diff review                                            | doc prose — verified by direct read at GATE-COMPLETE, not automatable |

## Tasks

- [ ] `.agents/tasks/CLI-067.md` — T1~T8 (TC-01~TC-07 매핑 + wrap-up)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: YAML block present at file start; `status: draft`; `type: BEHAVIOR` (valid prefix); `tags: [cli, typescript]` present.
- Problem: concrete symptoms with file/line references (`diagnose-command.ts:47-65`, `:77-105`, `:173-215`, `cli.ts:90-93`) and exact wrong outputs (`✗ API key: No API key found`, exit 0 after `✗ N issue(s) found`); reproduction condition stated (verified 2026-06-11, L1, npm-installed 3.0.0-beta.73, configured profile with `$ENV:` key); no TBD/TODO or vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (5 check functions enumerated, 2 in scope, dispatch exit-code loss confirmed, framework `env` injection availability confirmed); 3 alternatives each with pro/con; Decision references the driving trade-off (SSOT resolution vs message-shape stability).
- Completion Criteria: 7 items, all `TC-N` prefixed (TC-01–TC-07); ≥1 criterion per problem sub-item (resolution: TC-01–03, settings levels: TC-04, exit code: TC-05, plus TC-06 security, TC-07 docs); all use command/observable forms (`echo $?` → 1, "reports ✓ naming the profile"); no forbidden vague phrases.
- Test Plan: section present; 7 rows match 7 TC-N (count matches); every row has non-empty Test Type and Tool/Approach, no TBD; sole manual row (TC-07) has Notes explaining non-automatability (doc prose, direct read at GATE-COMPLETE).
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present and empty at first run; no `## Status` or `## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval: user replied exactly "승인함" (2026-06-13) in the current conversation, after being told verbatim that replying "승인함" authorizes implementation of the 11 approved designs.
- Directed at this spec: the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건" summarized CLI-067 individually (API-key check reuses runtime resolution functions, settings → env-default CLI-066 order; user-level and project settings validated independently; exit-code policy 0 = no issues / 1 = issues) and explicitly flagged the 067 exit-code policy as a product-direction decision; the prior "머지하고 main 릴리스 진행해줘" was a release instruction (PR #705, docs-only) and was not counted as design approval.
- No post-approval-request modification of Architecture Review or frontmatter type/tags: only changes after the approval request were the GATE-WRITE Evidence Log entry, frontmatter status draft → review-ready, and prettier formatting (commit cd5b1053a).
- No implementation before this gate: `.agents/tasks/CLI-067.md` absent (verified via ls), `git status` clean for `packages/agent-cli` and `.agents/tasks`, latest commits to `diagnose-command.ts`/`cli.ts` belong to prior items (CLI-066 #700 and earlier) — NON-COMPLIANCE trigger not met.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-067.md` exists (read and verified; header references this spec as Test Plan SSOT).
- Tasks file path recorded in `## Tasks` section of this spec: `- [ ] .agents/tasks/CLI-067.md — T1~T8 (TC-01~TC-07 매핑 + wrap-up)`.
- Tasks correspond to Completion Criteria — one task per TC-N: T1↔TC-01 (provider check via `readProviderSettings`, profile `$ENV:` ✓), T2↔TC-02 (env-default agreement), T3↔TC-03 (✗ with runtime guidance + issue count), T4↔TC-04 (all `getProviderSettingsPaths` levels, corrupt user-level flagged), T5↔TC-05 (issue-count → exit-code matrix incl. `cli.ts` dispatch), T6↔TC-06 (no key value in output), T7↔TC-07 (SPEC.md documents checks + 0/1 exit contract); plus T8 wrap-up (test/typecheck/lint/build, PR, evidence, archive). All 7 TC-N covered.
- NON-COMPLIANCE trigger not met: branch `feat/cli-067-diagnose-accuracy` has no commits touching `packages/agent-cli/src` beyond develop; `git status` clean for `packages/agent-cli`; latest commits to `diagnose-command.ts`/`cli.ts` are prior items (CLI-066 #700 and earlier) — tasks file exists before any implementation.
