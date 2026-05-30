---
title: 'EX-006: 문서 배치 처리기 — 병렬 AI 분석 파이프라인'
status: done
done_at: 2026-05-25
pr: '615'
created: 2026-05-25
priority: medium
urgency: later
area: examples/batch-processor
depends_on: []
---

## Background

다수의 파일/URL을 AI로 병렬 처리하는 패턴은 데이터 파이프라인, 문서 관리,
콘텐츠 분류 등에서 흔하게 쓰인다.

"서버 없이, 한 번 실행하고 끝나는" 배치 스크립트로 agent-framework의
순수 프로그래밍 API를 가장 잘 보여주는 예제.

## 구현 목표

```
examples/batch-processor/
  package.json
  tsconfig.json
  .env.example
  README.md
  sample-docs/
    doc1.md
    doc2.md
    doc3.md
  src/
    index.ts    — 병렬 배치 처리 메인
    processor.ts — 단일 문서 처리 (요약 + 키워드 추출)
    reporter.ts  — 결과를 JSON/Markdown으로 저장
```

### 핵심 패턴

1. `sample-docs/` 디렉터리의 모든 `.md` 파일 목록화
2. `createQuery` 인스턴스 N개 생성 (병렬 처리용)
3. `Promise.all()` 또는 concurrency-limited 배치로 동시 처리
4. 각 문서: 요약 + 주요 키워드 + 감정 분석
5. 결과를 `output/report.json`과 `output/report.md`로 저장

### 보여줄 것

- 서버 없는 순수 배치 스크립트
- 동시 병렬 AI 호출 (rate limit 고려)
- 구조화된 출력 (JSON Schema 기반 응답)
- 진행 상황 표시 (`console.log` progress bar)

### 기술 스택

- `@robota-sdk/agent-framework` — `createQuery`
- `@robota-sdk/agent-provider` — 공급자
- `p-limit` — 동시성 제어 (rate limit 방지)

## Test Plan

- `npm run start` 실행 후 `output/report.json` 파일 생성 확인

## User Execution Test Scenarios

### Scenario 1: 배치 처리 실행

**Steps:**

```bash
ANTHROPIC_API_KEY=... npm run start
```

**Expected:**

- 3개 샘플 문서를 병렬 처리
- `output/report.json`, `output/report.md` 생성
- 각 문서의 요약, 키워드, 감정 포함
