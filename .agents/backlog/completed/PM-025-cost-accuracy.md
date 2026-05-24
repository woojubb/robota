---
title: 'PM-025: /cost 정확도 개선 — provider 가격표 내장 + 실시간 계산'
status: done
created: 2026-05-24
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-framework
depends_on: []
---

## Background

현재 `/cost` 명령이 토큰 사용량을 표시하지만 실제 비용(달러)이 부정확하거나 표시되지 않는다 (senior-dev-report 지적). 개발자가 AI 도구를 도입할 때 비용 예측이 핵심 의사결정 요소인데, "얼마 들었는지 모르는" 상태는 신뢰를 낮춘다.

특히:

- Claude Sonnet 3.7 vs Haiku 3.5 비용 차이가 10배 이상
- 장시간 세션에서 누적 비용을 모르면 예산 초과 위험
- 팀 도입 시 "이거 얼마나 들어요?" 질문에 답 못함

## 작업 항목

### provider 가격표 내장

```typescript
// packages/agent-framework/src/pricing.ts
export const MODEL_PRICING: Record<string, { input: number; output: number; unit: number }> = {
  'claude-opus-4-7': { input: 15, output: 75, unit: 1_000_000 },
  'claude-sonnet-4-6': { input: 3, output: 15, unit: 1_000_000 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25, unit: 1_000_000 },
  // ... 주요 모델 포함
};
```

### 세션 내 실시간 비용 추적

- 각 API 호출마다 `usage.input_tokens` + `usage.output_tokens` 누적
- 모델 가격표와 곱해서 USD 계산
- `/cost` 실행 시 세션 누적 비용 표시

### `/cost` 출력 형식

```
세션 토큰 사용량:
  입력:  45,231 tokens  ($0.136)
  출력:  12,847 tokens  ($0.193)
  합계:                  $0.329

모델: claude-sonnet-4-6
세션 시간: 23분
```

### 가격 업데이트 메커니즘

- 가격표는 코드에 하드코딩 (정적 배포 대상)
- 버전 릴리스마다 최신 가격 반영
- 가격 변경 시 CHANGELOG에 명시

## 성공 기준

- `/cost` 실행 시 USD 금액 표시
- 하루 세션 누적 비용을 인식할 수 있음
- 가격이 0으로 표시되는 케이스 없음 (알려진 모델 기준)
