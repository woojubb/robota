---
title: 'DOCS-004: content/ko 한국어 문서 최신화 (v2-era 재작성 + 끊긴 링크)'
status: todo
created: 2026-06-16
priority: medium
urgency: later
area: content/ko
depends_on: [DOCS-002]
---

# DOCS-004: content/ko 한국어 문서 최신화

## Problem

근거: `.design/docs-audit/2026-06-16/report-content-examples-integrations.md`.

- `content/ko/getting-started/README.md`: 전체가 v2-era라 실행 불가 — 비존재 `@robota-sdk/anthropic`/
  `openai`, 미export `createAgent`, 잘못된 옵션(`providers:` 문자열 `defaultModel`), 구 모델 id
  `claude-sonnet-4-5`, 인라인 tool 리터럴. 현재 영어 getting-started와 한 세대 차이.
- `content/ko/README.md`: `/ko/guide`·`/ko/examples`·`/ko/packages` 링크가 존재하지 않는 섹션을 가리킴.

## Solution

ko/getting-started를 현재 영어 `content/getting-started/README.md`(검증상 clean)에 맞춰 재작성
(`new Robota({ aiProviders, defaultModel: {...} })`, `@robota-sdk/agent-provider/anthropic`,
`createZodFunctionTool`, 모델 id `-4-6`). ko/README의 끊긴 링크는 해당 한국어 섹션 생성 또는 영어
대응 문서로 연결.

## Completion Criteria

- [ ] TC-01: ko/getting-started가 현재 영어 getting-started의 API/옵션/모델 id와 일치
- [ ] TC-02: ko/getting-started에 비존재 패키지/심볼(`@robota-sdk/anthropic`, `createAgent`) 0건
- [ ] TC-03: ko/README의 끊긴 내부 링크 0건(존재 섹션 또는 영어 대응으로 연결)
- [ ] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                    |
| ----- | ---------- | --------------------------- |
| TC-01 | Doc review | 영어 getting-started와 대조 |
| TC-02 | Doc/grep   | 비존재 식별자 grep → 0건    |
| TC-03 | Doc review | 링크 대상 존재 확인         |
| TC-04 | Harness    | `pnpm harness:scan`         |

## User Execution Test Scenarios

ko/getting-started는 사용자 실행 절차다. 수정 후 한국어 빠른시작 코드가 현재 API로 타입체크/빌드되는지
확인(영어판과 동일 검증 경로). 링크 정정은 prose라 Not applicable.

## Tasks

- [ ] ko/getting-started 재작성 → ko/README 링크 정정 → grep/harness:scan

## Evidence Log

(구현 후 작성)
