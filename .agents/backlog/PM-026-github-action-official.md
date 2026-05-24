---
title: 'PM-026: 공식 GitHub Action — robota-sdk/action@v1'
status: todo
created: 2026-05-24
priority: medium
urgency: soon
area: apps/, packages/agent-cli
depends_on: []
---

## Background

GitHub Action은 개발자가 Robota CLI를 처음 "진짜로 써보는" 채널이 될 수 있다. 코드 리뷰, PR 설명 자동 생성, 테스트 실패 분석 같은 use case가 명확하고, Action 한 줄이면 팀 전체에 도입된다.

Aider는 GitHub Action이 없어서 팀 도입 장벽이 높다. 공식 Action이 있으면 robota.io 첫 화면에서 "지금 바로 리뷰봇 추가" CTA를 만들 수 있다.

## 작업 항목

### Action 구조

```yaml
# .github/workflows/robota-review.yml
- uses: robota-sdk/action@v1
  with:
    task: 'Review the PR changes and provide feedback'
    model: claude-sonnet-4-6
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    output: comment # 또는 summary, file
```

### 지원 use case (MVP)

1. **PR Review**: 변경된 파일 분석 → GitHub PR comment 자동 생성
2. **Commit Message**: 스테이징된 변경 분석 → 커밋 메시지 제안
3. **Test Failure Analysis**: 실패한 CI 로그 → 원인 분석 + 수정 제안

### 구현

- `apps/action/` 디렉토리 생성
- `action.yml` + Docker 또는 Node.js composite action
- robota CLI의 `-p` (headless) 모드 사용
- GitHub API 연동: PR comment 작성, PR 설명 업데이트

### 배포

- `robota-sdk/action` GitHub 저장소 (별도 저장소 또는 monorepo 내 패키지)
- GitHub Marketplace 등록
- robota.io 문서에 Quick Start 가이드

## 성공 기준

```yaml
- uses: robota-sdk/action@v1
  with:
    task: 'Review this PR for bugs and style issues'
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

이 코드가 실제 PR에서 동작하고 코드 리뷰 코멘트가 달림.
