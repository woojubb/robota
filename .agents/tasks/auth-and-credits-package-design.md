---
title: 인증 + 크레딧 시스템 패키지 설계
status: backlog
created: 2026-03-15
priority: high
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
