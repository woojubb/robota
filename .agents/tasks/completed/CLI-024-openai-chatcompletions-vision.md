---
title: 'CLI-024: OpenAI ChatCompletions 경로 vision(이미지 입력) 지원'
status: done
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-provider
depends_on: [CLI-014]
---

## Background

OpenAI Responses API 경로는 이미지를 처리하지만, `packages/agent-provider-openai-compatible/src/shared/openai-compatible/message-converter.ts:33-36`의 ChatCompletions 경로는 user 메시지를 문자열로만 변환한다. GPT-4o 등 비전 모델을 ChatCompletions 경로로 사용할 경우 이미지가 조용히 drop된다.

DeepSeek, Qwen(ChatCompletions 경로), Gemma도 동일한 shared converter를 사용하므로 같은 문제가 있다.

## 작업 항목

- `shared/openai-compatible/message-converter.ts`의 `convertMessage` 함수 수정
  - `msg.parts` 배열이 있는 경우 OpenAI `content_block` 배열 형식으로 변환:
    - text 파트 → `{ type: 'text', text: string }`
    - image 파트 → `{ type: 'image_url', image_url: { url: string } }`
  - parts가 없거나 text only인 경우 기존 string 변환 유지 (하위 호환)
- `provider-definition.ts`에서 ChatCompletions 경로의 vision capability 선언 활성화
- 비전 미지원 모델(DeepSeek, Gemma 등)에 이미지 전달 시 명시적 에러 또는 provider level 검증 추가

## Test Plan

- GPT-4o ChatCompletions 경로로 base64 이미지 포함 메시지 전송 시 API 정상 응답 확인
- 비전 미지원 프로바이더에 이미지 전달 시 적절한 에러 발생 확인
- 기존 text-only 메시지 변환 회귀 없음 확인

## User Execution Test Scenarios

### Scenario 1: GPT-4o 이미지 입력

```bash
robota -p "이 이미지를 설명해줘" --attach screenshot.png --provider openai --model gpt-4o
```

Expected: 이미지 내용을 정확히 설명하는 응답 반환
