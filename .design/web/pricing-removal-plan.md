# Pricing 기능 제거 개요

> 세부 작업과 체크리스트는 `CURRENT-TASKS.md`의 **Priority 4 · Pricing 기능 제거** 섹션에서 관리합니다. 본 문서는 제거 대상과 전환 원칙만 요약합니다.

## 목표
- 모든 pricing/billing/subscription UI·API·설정 제거
- 무료 크레딧 기반 사용량 제한 시스템으로 전환
- Stripe/결제 의존성 및 환경 변수 제거

## 제거 범위 요약
1. **UI**
   - `/pricing` 라우트 및 관련 컴포넌트
   - Header/Navigation의 Pricing 링크
   - Upgrade 프롬프트, Plan 표시, Dashboard Billing 섹션
2. **API/타입**
   - `/api/v1/billing/*`, `/api/v1/subscriptions/*`, `/api/v1/user/transactions`
   - `apps/web/src/types/billing.ts`, `lib/billing/plans.ts`
   - Firebase billing 컬렉션 (subscriptions/billingCycles/invoices)
3. **사용량 제한**
   - Plan 기반 로직 → 무료 크레딧 기반
   - Rate limiting과 크레딧 소진 UX 통합 ("Free usage remaining" 메시지)
4. **설정/문서**
   - Stripe 관련 환경 변수 및 문서 제거
   - Billing 관련 테스트·가이드 정리

## 무료 크레딧 시스템 개요
```ts
interface UserCredit {
  userId: string;
  monthlyAllocation: { requests: number; tokens: number; resetDate: Date; };
  currentUsage: { requests: number; tokens: number; lastUpdated: Date; };
  remaining: { requests: number; tokens: number; };
  status: 'active' | 'limited' | 'suspended';
  limitReachedAt?: Date;
}
```
- 90%/100% 도달 시 친화적 알림, 업그레이드 유도 금지
- 메시지 예시: "Free usage remaining: 2,500 requests. Resets on Jan 1."

## 마이그레이션 원칙
- 기존 Free 사용자는 변화 없음, Paid 사용자는 Free tier로 전환 (할당량 보정)
- Billing 데이터는 아카이브 후 참조용으로 보존
- Feature flag(`ENABLE_PRICING`)로 롤아웃, 필요 시 A/B 테스트

## 성공 지표
- pricing/billing 관련 코드 및 UI 전량 제거
- 무료 크레딧 시스템 정상 동작 (빌드/테스트 통과)
- 사용자-facing 메시지에서 업그레이드 유도 표현 0건

---

필요한 작업이 실행 단계로 올라가면 `CURRENT-TASKS.md` Priority 4 항목에 세부 단계/검증 명령어를 추가하세요.
