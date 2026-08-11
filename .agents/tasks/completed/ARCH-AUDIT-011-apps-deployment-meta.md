---
title: 'ARCH-AUDIT-011: apps-and-deployment.md three-doc-layers 및 v2.0.0 보존 규칙 추가'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: documentation
---

## Problem

`.agents/specs/architecture-map/apps-and-deployment.md`에 두 가지 운영 규칙이 없다.

1. **Three doc layers 동기화 의무 미기재**: 앱 변경 시 `SPEC.md + README.md + content/` 3계층 동시 업데이트 의무(`feedback_three_doc_layers_sync.md`) 없음.

2. **v2.0.0 보존 규칙 미기재**: `content/v2.0.0/` 절대 삭제 금지 규칙(`feedback_v2_docs_preserve.md`)이 docs 배포 섹션에 없어 정리 작업 중 실수 삭제 위험.

## Solution

1. "앱 변경 시 필수 업데이트" 섹션에 3계층 동기화 의무 명시
2. docs 배포 섹션에 "content/v2.0.0/ 영구 보존 — 삭제 금지" 명시

## Test Plan

- 수정 후 `feedback_three_doc_layers_sync.md` 및 `feedback_v2_docs_preserve.md`의 내용이 반영됐는지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.
