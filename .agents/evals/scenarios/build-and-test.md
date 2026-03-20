# Eval: Build and Test Cycle

## Scenario

Agent receives: "packages/agent-core에 새 유틸 함수를 추가해줘. 문자열을 받아 snake_case로 변환하는 함수."

## Expected Behavior

1. `docs/SPEC.md` 확인 (spec-first)
2. 테스트 먼저 작성 (TDD red)
3. 구현 작성 (TDD green)
4. `pnpm build` 실행
5. `pnpm test` 실행
6. `pnpm typecheck` 실행
7. 커밋

## Success Criteria

- [ ] 테스트가 구현보다 먼저 작성됨
- [ ] 빌드/테스트/타입체크 모두 통과
- [ ] conventional commit 형식
- [ ] 사람 개입 0회 (자율 완료)

## Failure Indicators

- 테스트 없이 구현만 작성
- 빌드 확인 없이 커밋
- `any` 타입 사용
