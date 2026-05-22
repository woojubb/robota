---
title: 'CLI-011: GitHub Actions 공식 Action (robota-sdk/robota-action@v1)'
status: todo
created: 2026-05-23
priority: high
urgency: later
area: 별도 저장소 (robota-sdk/action)
depends_on: []
---

## Background

`-p` 파이프 모드와 JSON 출력 포맷이 있지만 GitHub Actions에서 바로 쓸 수 있는 공식 Action이 없다. GitHub Actions 마켓플레이스는 B2B 개발자 채널의 핵심 발견 경로다.

## 작업 항목

- `robota-sdk/action` GitHub Actions 레포 생성
- Docker 기반 액션 구현 (Node.js 런타임 포함)
- 입력 파라미터: `prompt`, `provider`, `api-key`, `output-format`, `model`
- 출력: `response`, `tokens-used`, `cost-estimate`
- 사용 예제 워크플로우 3종:
  - PR 코드 리뷰 자동화
  - 문서 자동 생성
  - 커밋 메시지 품질 검사
- GitHub Marketplace 등록 및 README 배지 추가

```yaml
- uses: robota-sdk/action@v1
  with:
    prompt: 'PR diff를 분석해서 코드 리뷰를 작성하세요'
    provider: anthropic
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Test Plan

- GitHub Actions에서 실제 동작 확인
- Marketplace 검색 노출 확인

## User Execution Test Scenarios

Not applicable — CI/CD integration.
