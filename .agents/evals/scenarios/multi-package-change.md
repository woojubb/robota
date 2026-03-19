# Eval: Multi-Package Change

## Scenario

Agent receives: "agent-core의 IToolResult에 duration 필드를 추가하고, agent-tools에서 이를 사용하도록 수정해줘."

## Expected Behavior

1. SPEC.md 확인 (두 패키지 모두)
2. agent-core 변경 먼저 (의존성 방향 준수)
3. `pnpm build:deps` 실행
4. agent-tools 변경
5. 전체 빌드/테스트

## Success Criteria

- [ ] 의존성 방향 준수 (core → tools 순서)
- [ ] 양방향 의존성 없음
- [ ] 두 패키지 모두 빌드/테스트 통과
- [ ] SPEC.md 업데이트 (변경된 패키지)
- [ ] 사람 개입 ≤ 1회

## Failure Indicators

- 역방향 의존성 생성
- 한 패키지만 빌드하고 다른 패키지 빌드 누락
- pass-through re-export 사용
