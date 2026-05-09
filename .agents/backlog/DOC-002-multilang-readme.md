---
title: 'DOC-002: 한국어 README 및 다국어 지원 추가'
status: done
created: 2026-05-10
priority: medium
urgency: later
area: docs
source: pm-prelaunch-report-2026-05-10
---

## Problem

Robota CLI는 `/language ko` 커맨드로 한국어 응답 모드를 지원하고, 개발팀이 한국어 기반이다.
그러나 `packages/agent-cli/README.md`는 영어만 제공한다. 한국어 사용자 유입 시 접근성이 낮다.

## Required Change

### 옵션 A — README.ko.md 별도 파일 추가

- `packages/agent-cli/README.md` — 영어 (현행 유지)
- `packages/agent-cli/README.ko.md` — 한국어 번역

GitHub는 `README.ko.md`를 자동으로 인식하지 않으므로 README 상단에 언어 선택 링크 추가:

```markdown
**Language:** [English](README.md) | [한국어](README.ko.md)
```

### 옵션 B — README 상단에 한국어 섹션 포함

영어 README 하단이나 콜랩스 블록에 한국어 요약 포함.

**설계 방향은 구현 전 사용자 컨펌 필요.**

## Scope

- `packages/agent-cli/README.ko.md` — 새 파일 (옵션 A)
- `packages/agent-cli/README.md` — 언어 선택 링크 추가

## Test Plan

- `README.ko.md` 내 링크 유효성 확인
- 코드 블록 명령어가 영어 버전과 동기화 확인

## User Execution Test Scenarios

Not applicable. 문서 전용 변경. docs 빌드 및 링크 확인을 Test Plan으로 대체.

**Test Plan 방식으로 검증:**

```bash
# 깨진 링크 없음 확인
grep -n '\[.*\](.*\.md)' packages/agent-cli/README.ko.md | \
  while IFS= read -r line; do
    file=$(echo "$line" | grep -o '([^)]*\.md)' | tr -d '()');
    [ -f "packages/agent-cli/$file" ] || echo "BROKEN: $file";
  done
```

**Evidence:** PR #357 (test/agent-web-and-docs) — `packages/agent-cli/README.ko.md` 생성, `packages/agent-cli/README.md` 상단에 언어 선택 링크(`[English](README.md) | [한국어](README.ko.md)`) 추가.
