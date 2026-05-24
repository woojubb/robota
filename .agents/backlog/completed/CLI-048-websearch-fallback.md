---
title: 'CLI-048: WebSearch BRAVE_API_KEY 없을 때 폴백 및 문서화'
status: todo
created: 2026-05-24
priority: low
category: feature
---

## 문제

`BRAVE_API_KEY`가 없으면 WebSearch가 완전히 비활성화된다.
다른 무료 옵션(DuckDuckGo HTML, SearXNG 등)으로의 폴백이 없어 도구가 사실상 선택적 기능이 된다.

추가로:

- README 환경변수 표에 `BRAVE_API_KEY`가 없다
- README 내장 도구 목록에 WebSearch의 `BRAVE_API_KEY` 의존성이 명시되지 않는다

## 해결 방법

**최소 대응 (P1):** README 환경변수 표와 도구 목록에 `BRAVE_API_KEY` 요구사항 명시

**완전 대응 (P2):** 폴백 검색 엔진 추가 (예: DuckDuckGo HTML 파싱, 또는 `SEARCH_API_KEY` 추상화)

## 수용 기준

- [ ] README 환경변수 표에 `BRAVE_API_KEY` 추가 (필수)
- [ ] WebSearch 도구 설명에 API 키 요구사항 명시
- [ ] (선택) `BRAVE_API_KEY` 없을 때 graceful degradation 메시지

## 관련 파일

- `packages/agent-tools/src/builtins/web-search-tool.ts`
- `packages/agent-cli/README.md`
