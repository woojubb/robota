---
title: Anthropic provider — always use streaming to avoid 10 minute timeout
status: backlog
priority: high
created: 2026-03-23
packages:
  - agent-provider-anthropic
---

## 문제

`onTextDelta`가 없을 때 non-streaming `messages.create`를 사용하는데, Anthropic SDK가 non-streaming 요청에 10분 timeout을 적용. 긴 tool loop 후 응답 생성이 오래 걸리면 "Streaming is required for operations that may take longer than 10 minutes" 에러 발생.

## 해결 방향

`onTextDelta` 유무와 관계없이 항상 streaming API를 사용. delta callback이 없으면 streaming 결과만 조립해서 반환 (callback 호출 생략).

## 참고

- https://github.com/anthropics/anthropic-sdk-typescript#long-requests
- 현재 코드: `packages/agent-provider-anthropic/src/provider.ts` 131-136행
