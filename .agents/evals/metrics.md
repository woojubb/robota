# Agent Autonomy Metrics

에이전트 자율성과 효율성을 측정하는 핵심 지표.

## Primary Metrics

### 1. One-Shot CI Pass Rate

- **정의**: 에이전트가 작성한 코드가 첫 번째 시도에서 CI(빌드+테스트+타입체크)를 통과하는 비율
- **목표**: ≥ 80%
- **측정**: `pnpm build && pnpm test && pnpm typecheck` 성공 여부
- **참고**: Stripe 기준 (Minions one-shot success rate)

### 2. Human Intervention Rate

- **정의**: task 완료까지 사람이 개입한 횟수 / 전체 tool 호출 수
- **목표**: < 20%
- **개입 기준**: 사용자가 에이전트의 접근 방식을 수정하거나 에러를 지적한 경우
- **참고**: Manus autonomy metric

### 3. Tool Diversity Score

- **정의**: 세션에서 사용한 고유 tool 종류 수 / 사용 가능한 tool 수
- **목표**: ≥ 50% (6개 tool 중 3개 이상 사용)
- **의미**: 단일 tool에 의존하지 않고 적절한 tool을 선택하는 능력

### 4. Loop Rework Rate (advisory, a declared proxy)

- **정의**: 기록된 CLOSED 루프 실행 중 종료 사유가 `converged`가 **아닌** 것의 비율. 분모는 닫힌 실행이며,
  OPEN 실행은 제외하고 따로 보고한다 — 끝나지 않은 실행은 수렴한 것도 아니고 수렴하지 못한 것도 아니다.
- **측정**: `pnpm harness:loop:report` (`scripts/harness/loop-economics.mjs`), `.agents/loop-runs/` 대장을 읽는다.
- **목표**: 아직 없음. 코퍼스가 비어 있는 상태에서 시작하므로, 이 저장소 자신의 실행이 아니라 외부 주장에서
  가져온 임계값은 `measurement-provenance.md`가 거부하는 동어반복이다. 관측된 분포가 임계값을 정한다.
- **PROXY임을 명시한다.** 실제로 원하는 값은 **cost per accepted change**이고, 이것은 그 대리 지표다.
  DORA가 2024년 deployment rework rate를 도입할 때와 같은 이유 — 직접 측정 불가능한 양의 명시적 대리.
- **관측하지 못하는 것**: 토큰과 실시간 비용. OpenTelemetry GenAI 규약상 토큰 사용량은 모델 호출 지점에서
  계측 클라이언트가 방출하며(`gen_ai.usage.input_tokens` / `output_tokens`), 이 하네스에는 그 지점이 없다.
  또한 수렴한 실행의 산출물이 나중에 되돌려졌는지도 알지 못한다.
- **advisory이며 아무것도 차단하지 않는다** — `patch-coverage` 선례. 필수 컨텍스트는 실패할 수 있어야 하고,
  임계값이 없는 지표는 실패할 수 없다.
- **왜 필요한가**: `record-local-review.mjs`가 이 숫자를 손으로 딱 한 번 측정한 기록을 담고 있다 — 5개 PR에
  리뷰 라운드 38회, 그중 24회가 블로킹, 라운드당 CI 6-10분. 그 측정이 local-review 기록과 pre-push 거부를
  낳았다. 즉 이 숫자는 실제로 결정을 바꾼다. 그런데 다시 측정할 방법이 없었다.

### 5. Work-run claim-to-ready and time-to-first-PR

- **정의**: repository work가 claim된 시점부터 validated ready receipt까지의 wall/active/paused/
  phase 시간. GitHub와 정확히 결합될 때만 server `createdAt`까지를 `time-to-first-pr`로 보고한다.
- **측정**: `pnpm harness:work-run:report`; durable receipts는 `.agents/evals/work-runs/`, raw local
  events는 `.agents/evals/local-metrics/work-runs/`에 있다.
- **분모**: `included`, `superseded`, `excluded`, `invalid`, `unavailable`을 항상 함께 보고한다.
- **집계**: cohort는 lane/work-kind이며 p50/p90만 계산한다. 개인 순위나 percentile 평균은 만들지 않는다.
- **경계**: pre-PR revision은 같은 root interval이고, PR 이후 finding/red-check/rebase generation은
  별도 rework다. 이 지표는 DORA change lead time이 아니다.

## Secondary Metrics

### 6. Spec Conformance

- **정의**: 변경된 패키지의 SPEC.md가 코드와 일치하는 비율
- **목표**: 100%
- **측정**: spec-code-conformance 스킬 실행 결과

### 7. Build Verification Rate

- **정의**: 커밋 전 빌드/테스트를 실행한 비율
- **목표**: 100%
- **측정**: 커밋 직전 `pnpm build` + `pnpm test` 실행 여부

## Measurement Cadence

- **세션별**: eval-log 훅이 Stop 시 `.agents/evals/local-metrics/`에 자동 수집
- **주간**: `pnpm harness:lessons:digest`가 최근 7일 lesson signal을 `.agents/evals/lessons/weekly-digest.md`로 재생성
- **릴리즈별**: 전체 메트릭 스냅샷 기록

## Lesson Signal Metrics

Phase C auto-lessons metrics are local generated signals. They are candidates for review, not rules.

| Metric              | Source JSONL        | Meaning                                                  |
| ------------------- | ------------------- | -------------------------------------------------------- |
| `blocks_total`      | `blocks.jsonl`      | PreToolUse forbidden pattern blocks                      |
| `corrections_total` | `corrections.jsonl` | User correction prompts such as "다시" or "wrong"        |
| `reverts_total`     | `reverts.jsonl`     | Repeated edits, repeated tool errors, fix/revert commits |

When a pattern reaches at least 5 events in 7 days, the digest command upserts a candidate in `.agents/evals/lessons/auto-lessons.md`. `.agents/rules/common-mistakes.md` remains human-curated only.
