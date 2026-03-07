# 현재 작업

## 완료된 작업

### Priority 1
- [x] 하네스 스크립트 회귀 테스트 추가
- [x] DAG node runtime 분리 후속 검증 강화

### Priority 2
- [x] 하네스 report 산출물 표준화
- [x] 레거시 skill 정리 (36개 → 29개)
- [x] Policy Enforcement 하네스 스크립트 추가

### Priority 3
- [x] Observability 하네스
- [x] App Boot 하네스
- [x] Agents 패키지 추가 개선
  - 플러그인 실행 순서: PluginPriority 기반 삽입 정렬 (higher priority first, stable)
  - 이벤트 계층 추적: IEventContext에 depth (ownerPath.length 자동) + spanId (auto-generated) 추가

### Skill 통합
- [x] `quality-standards` + `boundary-validation` → `type-boundary-and-ssot` 통합
- [x] `functional-core-imperative-shell` + `hexagonal-architecture-ts` + `ts-oop-di-patterns` → `architecture-patterns` 통합
