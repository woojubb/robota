# Pricing 기능 제거 계획

## 개요

홈페이지에서 모든 pricing, billing, subscription 관련 기능을 제거하여 완전한 무료 플랫폼으로 전환합니다. 사용량 제한 기능은 "무료 크레딧" 시스템으로 유지하되, 업그레이드 프롬프트는 모두 제거합니다.

## 제거 대상 식별

### 1. 핵심 Pricing/Billing 파일들
- `apps/web/src/types/billing.ts` - 전체 billing 타입 정의
- `apps/web/src/lib/billing/plans.ts` - 요금제 정의 (starter, pro, enterprise 제거)
- `apps/web/src/lib/firebase/user-credit-service.ts` - 크레딧 서비스 (수정 필요)
- `apps/web/src/app/api/v1/user/transactions/route.ts` - 거래 내역 API

### 2. UI 컴포넌트들
- Pricing 페이지 및 컴포넌트들
- Upgrade 버튼 및 프롬프트들
- Plan comparison 컴포넌트들
- Billing 설정 페이지들

### 3. API 엔드포인트들
- 결제 관련 API들
- 구독 관리 API들
- 청구서 생성 API들

## 4단계 제거 계획

### Phase 1: Pricing UI 컴포넌트 및 페이지 제거
**목표**: 사용자에게 보이는 모든 pricing 관련 UI 제거

**작업 항목**:
1. **Pricing 페이지 제거**
   - `/pricing` 라우트 삭제
   - 관련 컴포넌트 삭제

2. **Header/Navigation에서 Pricing 링크 제거**
   - `apps/web/src/components/layout/header.tsx`
   - Navigation 메뉴에서 "Pricing" 항목 제거

3. **Upgrade 프롬프트 제거**
   - 모든 "Upgrade to Pro" 버튼 제거
   - Plan limitation 경고 메시지 제거
   - Usage limit 도달 시 upgrade 제안 제거

4. **Dashboard에서 Plan 정보 제거**
   - 현재 플랜 표시 제거
   - Plan 변경 버튼 제거
   - Billing 정보 섹션 제거

### Phase 2: Billing 로직 및 API 엔드포인트 제거
**목표**: 백엔드에서 모든 billing 관련 로직 제거

**작업 항목**:
1. **Billing API 엔드포인트 제거**
   - `/api/v1/billing/*` 모든 엔드포인트 삭제
   - `/api/v1/subscriptions/*` 모든 엔드포인트 삭제
   - `/api/v1/user/transactions/route.ts` 삭제

2. **Billing 타입 및 인터페이스 제거**
   - `apps/web/src/types/billing.ts` 삭제
   - 관련 타입 참조 모두 제거

3. **Plan 기반 제한 로직 제거**
   - `apps/web/src/lib/billing/plans.ts`에서 paid plan 제거
   - Free plan만 유지하되 "Free Plan"이 아닌 "Default Limits"로 변경

4. **Firebase Billing 컬렉션 정리**
   - `subscriptions` 컬렉션 사용 중단
   - `billingCycles` 컬렉션 사용 중단
   - `invoices` 컬렉션 사용 중단

### Phase 3: 사용량 제한을 무료 크레딧 시스템으로 전환
**목표**: Billing 없이도 사용량 관리가 가능한 시스템 구축

**작업 항목**:
1. **크레딧 시스템 재설계**
   - `UserCredit` 타입 단순화
   - 월간 무료 크레딧 자동 충전 시스템
   - 크레딧 소진 시 대기 또는 제한 적용 (업그레이드 프롬프트 없음)

2. **사용량 제한 로직 수정**
   - Plan 기반 → 크레딧 기반으로 변경
   - Rate limiting을 크레딧 소모로 통합
   - 제한 도달 시 friendly 메시지 (업그레이드 언급 없음)

3. **Usage Dashboard 수정**
   - "Plan limits" → "Free usage limits"로 변경
   - "Upgrade" 버튼 → "Learn more about limits" 링크로 변경
   - 비용 정보 제거, 크레딧 정보만 표시

4. **크레딧 표시 UI 개선**
   - `apps/web/src/components/credits/credit-display.tsx` 수정
   - "Credits remaining" 대신 "Free usage remaining" 표시
   - 진행률 바 및 친화적인 메시지

### Phase 4: 설정 및 문서 업데이트
**목표**: 모든 참조 문서 및 설정 파일 정리

**작업 항목**:
1. **환경 변수 정리**
   - Stripe 관련 환경 변수 제거
   - Payment 관련 설정 제거

2. **문서 업데이트**
   - API 문서에서 billing 엔드포인트 제거
   - README에서 pricing 관련 내용 제거
   - 사용자 가이드 업데이트

3. **타입 정의 정리**
   - `apps/web/src/types/index.ts`에서 billing 관련 export 제거
   - 사용하지 않는 타입 정의 제거

4. **테스트 코드 정리**
   - Billing 관련 테스트 제거
   - Credit 시스템 테스트 업데이트

## 새로운 무료 크레딧 시스템 설계

### 크레딧 구조
```typescript
interface UserCredit {
  userId: string;
  
  // 월간 무료 할당량
  monthlyAllocation: {
    requests: number;        // 10,000 requests/month
    tokens: number;          // 1,000,000 tokens/month
    resetDate: Date;         // 매월 1일 리셋
  };
  
  // 현재 사용량
  currentUsage: {
    requests: number;
    tokens: number;
    lastUpdated: Date;
  };
  
  // 남은 크레딧
  remaining: {
    requests: number;
    tokens: number;
  };
  
  // 상태
  status: 'active' | 'limited' | 'suspended';
  limitReachedAt?: Date;
}
```

### 제한 도달 시 UX
1. **90% 도달**: "You've used 90% of your free monthly allocation"
2. **100% 도달**: "You've reached your free monthly limit. Usage will reset on [date]"
3. **대안 제시**: "Consider optimizing your requests or try again next month"

### 친화적인 메시지 예시
- ❌ "Upgrade to Pro to continue"
- ✅ "You've reached your free monthly limit. Your allocation will reset on January 1st"
- ✅ "Free usage remaining: 2,500 requests this month"
- ✅ "Learn more about optimizing your API usage"

## 마이그레이션 전략

### 기존 사용자 처리
1. **현재 Free 사용자**: 변경 없음
2. **현재 Paid 사용자**: Free tier로 자동 전환, 더 높은 할당량 부여
3. **데이터 보존**: 사용량 히스토리는 유지, billing 히스토리는 아카이브

### 점진적 배포
1. **Feature Flag 사용**: `ENABLE_PRICING=false`로 기능 비활성화
2. **A/B 테스트**: 일부 사용자에게 먼저 적용
3. **모니터링**: 사용자 반응 및 시스템 안정성 확인

## 성공 지표

### 기술적 지표
- [ ] 모든 pricing 관련 코드 제거 완료
- [ ] 빌드 에러 0개
- [ ] 기존 기능 정상 동작
- [ ] 크레딧 시스템 정상 동작

### 사용자 경험 지표
- [ ] Pricing 관련 UI 완전 제거
- [ ] 사용량 제한 메시지 친화적으로 변경
- [ ] 업그레이드 프롬프트 0개
- [ ] 무료 사용자 이탈률 감소

## 위험 요소 및 대응

### 기술적 위험
1. **의존성 제거 시 오류**: 점진적 제거 및 충분한 테스트
2. **크레딧 시스템 버그**: 기존 시스템과 병행 운영 후 전환
3. **데이터 손실**: 백업 및 마이그레이션 스크립트 준비

### 비즈니스 위험
1. **수익 모델 부재**: 향후 다른 수익화 방안 검토 필요
2. **서버 비용 증가**: 사용량 모니터링 및 적절한 제한 설정
3. **남용 방지**: Rate limiting 및 abuse detection 강화

## 다음 단계

1. **Phase 1 실행**: UI 컴포넌트 제거부터 시작
2. **사용자 피드백 수집**: 변경사항에 대한 사용자 반응 모니터링
3. **시스템 최적화**: 무료 서비스 제공을 위한 비용 최적화
4. **향후 계획**: 새로운 비즈니스 모델 검토 및 계획 수립
