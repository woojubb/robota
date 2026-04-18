---
title: 인증 + 크레딧 시스템 패키지 설계
status: backlog
created: 2026-03-15
priority: high
urgency: later
---

## 요약

dag-designer에서 인증이 가능해야 하고, 크레딧 기능을 본격 도입하기 위한 패키지 구조 설계가 필요함.

## 요구사항

1. **인증 (Auth)**
   - apps/web의 dag-designer에서 사용자 인증
   - 어느 레이어에 붙일 건지 결정 (orchestrator? 별도 auth 서비스?)
   - 인증 패키지를 별도로 만들어 조립 가능하게

2. **크레딧 시스템**
   - 인증된 사용자별 크레딧 관리
   - dag-cost의 CEL 수식 기반 비용 추정과 연동
   - 사용자별 크레딧 잔액 → 실행 가능 여부 판단

3. **패키지 분리 원칙**
   - 모든 기능이 적절한 패키지로 분리
   - 조립해서 쓸 수 있는 구조
   - 인증, 크레딧, 과금은 각각 독립 패키지로

## 검토 필요 사항

- 인증 패키지: `@robota-sdk/auth` 또는 `@robota-sdk/dag-auth`?
- 크레딧 관리: `dag-cost`에 포함? 별도 `@robota-sdk/credits`?
- 과금/결제: 별도 레이어 (`@robota-sdk/billing`)?
- orchestrator에 auth middleware로 붙이는 방식?
- 사용자 세션/토큰 관리?

## 패키지 구조 후보

```
@robota-sdk/auth          — 인증 (토큰, 세션, 미들웨어)
@robota-sdk/credits       — 크레딧 잔액 관리 (사용자별)
@robota-sdk/dag-cost      — 비용 추정 (CEL 수식, 이미 존재)
@robota-sdk/billing       — 과금/결제 (크레딧 → 화폐 환산, 추후)
```

## 의존 방향 (예상)

```
apps/web → auth → orchestrator (auth middleware)
orchestrator → credits → dag-cost
billing → credits (추후)
```

## Published API 실행 시 인증/크레딧 흐름 (고난도)

```
외부 API 호출 (POST /api/v1/workflows/{dagId})
  ↓
1. 인증 (API key 검증)
  ↓
2. 크레딧 확인 (잔액 충분한지 사전 추정)
  ↓
3. 크레딧 선차감? or 예약?
  ↓
4. DAG 실행 (노드별 순차 실행)
  ↓
5. 노드별 실제 비용 확정 (실행 후에야 알 수 있음)
  ↓
6. 크레딧 정산 (추정 vs 실제 차이 조정)
  ↓
7. 결과 반환
```

### 핵심 난제

- **사전 추정 vs 사후 확정**: 실행 전 CEL 수식으로 추정 가능하지만 실제 비용은 다를 수 있음 (Gemini 토큰 등)
- **선차감 vs 사후차감**: 선차감하면 실패 시 환불 필요, 사후차감하면 잔액 부족 위험
- **중간 중단**: 크레딧 소진 시 DAG 실행 중간에 멈춰야 하는지
- **외부 API key와 내부 크레딧**: 외부 사용자의 API key가 어떤 크레딧 계정에 매핑되는지
- **동시 실행**: 여러 API 호출이 동시에 크레딧을 소비할 때 race condition

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
