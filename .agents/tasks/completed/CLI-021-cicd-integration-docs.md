---
title: 'CLI-021: CI/CD 통합 예제 문서 추가 (GitHub Actions 헤드리스 모드)'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: apps/docs
depends_on: []
---

## Background

`robota -p "..."` 헤드리스 모드와 `--output-format json` 플래그로 CI/CD 파이프라인에서 Robota CLI를 스크립트처럼 사용할 수 있지만, 이를 보여주는 문서가 없다.

GitHub Actions에서 Robota를 사용하는 예제는 파워 유저 획득과 바이럴 확산에 효과적인 콘텐츠다 (Claude Code, Cursor 등 경쟁사가 이 포지션을 공략 중).

## 작업 항목

- `content/guide/` 또는 `content/guide/cli.md`에 "CI/CD 통합" 섹션 추가
- GitHub Actions 워크플로우 예제 작성:

  ```yaml
  # .github/workflows/ai-review.yml
  - name: AI Code Review
    run: robota -p "Review the diff and suggest improvements" --output-format json
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  ```

- stdin 파이프 + 헤드리스 모드 조합 예제:

  ```bash
  git diff HEAD~1 | robota -p "Review this diff"
  ```

- `--no-session-persistence` 플래그 설명 (CI 환경에서 세션 저장 불필요)
- `--permission-mode bypassPermissions` 설명 (CI에서 확인 프롬프트 없이 실행)
- 환경 변수로 API 키 주입 방법 안내

## Test Plan

- 문서의 GitHub Actions 예제가 실제로 실행 가능한 올바른 YAML인지 확인
- 예제 명령어가 현재 CLI 버전과 일치하는지 확인

## User Execution Test Scenarios

Not applicable — documentation changes.
