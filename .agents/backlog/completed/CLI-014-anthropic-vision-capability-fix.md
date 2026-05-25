---
title: 'CLI-014: Anthropic provider vision capability 선언-미구현 불일치 수정'
status: done
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-provider
depends_on: []
---

## Background

`packages/agent-provider/src/anthropic/provider-definition.ts:81`에 `'vision'`이 capabilities로 선언되어 있으나, `convertToAnthropicFormat` (`message-converter.ts:18-23`)이 user 메시지를 `content: msg.content || ''` 단일 문자열로만 변환한다. `TUniversalMessage`의 `parts` 배열(이미지 포함)을 완전히 무시한다.

이미지 포함 user 메시지가 Anthropic 프로바이더에게 전달되면 이미지가 조용히 drop된다. 사용자는 vision 기능이 작동한다고 믿지만 실제로는 텍스트만 전달된다.

## 작업 항목

두 가지 선택지 중 하나를 선택한다:

**Option A (단기 수정): capability 선언 제거**

- `provider-definition.ts`에서 `'vision'`을 capabilities에서 제거
- 이미지 포함 메시지 전달 시 명시적 에러 또는 경고 emit

**Option B (완전 구현): message-converter에서 parts 처리 추가**

- `convertToAnthropicFormat`이 `msg.parts` 배열을 Anthropic `content_block` 형식으로 변환
  - `text` 파트 → `{ type: 'text', text: string }`
  - `image` 파트 → `{ type: 'image', source: { type: 'base64', ... } }` 또는 `url` 방식
- Anthropic API 명세에 맞는 `content_block[]` 포맷으로 user 메시지 전송
- vision capability 선언 유지

Option A를 즉시 적용하고, Option B는 별도 백로그(medium priority)로 분리하는 것을 권장한다.

## Test Plan

- Option A 선택 시: 이미지 포함 메시지 전송 시 capability 없음 에러가 명시적으로 발생하는지 확인
- Option B 선택 시: base64 인코딩 이미지 포함 메시지가 Anthropic API에 올바른 형식으로 전달되는지 확인
- capabilities 선언과 실제 동작 일치 여부 확인

## User Execution Test Scenarios

### Scenario 1: vision 선언 제거 확인 (Option A)

```bash
# 이미지 포함 메시지 시도 시 명시적 오류 발생 확인
robota -p "이 이미지를 설명해줘" --attach screenshot.png
```

Expected: vision 미지원 명시적 오류 메시지 출력 (이미지 조용히 drop 없음)
