---
title: 'ARCH-AUDIT-004: apps-and-deployment.md blog 앱 누락 및 배포 플랫폼 미기재 수정'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: documentation
---

## Problem

`.agents/specs/architecture-map/apps-and-deployment.md`에 두 가지 문제가 있다.

1. **blog 앱 누락**: `apps/` 디렉토리에 실제 존재하는 `blog` 앱이 배포 소유권 테이블에 없다. `git-branch.md`는 "Cloudflare Pages (blog, docs) deploys automatically"로 명시 — 문서 간 불일치.

2. **배포 플랫폼 미기재**: `agent-web`은 Vercel에 배포, `agent-server`는 Firebase Functions에 배포되나 문서는 "Node service", "Next.js frontend host"로만 기술.

## Solution

1. blog 앱을 소유권 테이블에 추가 (Cloudflare Pages, main 브랜치 push)
2. 소유권 테이블에 "배포 플랫폼" 열 추가 (Vercel / Firebase Functions / Cloudflare Pages)

## Test Plan

- `ls apps/` 결과와 테이블 앱 목록 대조
- 각 앱의 배포 플랫폼을 `vercel.json`, `firebase.json` 등 설정 파일로 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.
