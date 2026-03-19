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

## Secondary Metrics

### 4. Spec Conformance

- **정의**: 변경된 패키지의 SPEC.md가 코드와 일치하는 비율
- **목표**: 100%
- **측정**: spec-code-conformance 스킬 실행 결과

### 5. Build Verification Rate

- **정의**: 커밋 전 빌드/테스트를 실행한 비율
- **목표**: 100%
- **측정**: 커밋 직전 `pnpm build` + `pnpm test` 실행 여부

## Measurement Cadence

- **세션별**: eval-log 훅이 Stop 시 자동 수집
- **주간**: 누적 지표 리뷰 (수동)
- **릴리즈별**: 전체 메트릭 스냅샷 기록
