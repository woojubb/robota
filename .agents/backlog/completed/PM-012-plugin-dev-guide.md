---
title: 'PM-012: 플러그인 개발 가이드 + 플러그인 디렉토리 페이지'
status: done
created: 2026-05-23
priority: high
urgency: later
area: apps/docs
depends_on: []
---

## Background

플러그인 시스템이 있지만 "나만의 플러그인을 만드는 방법" 가이드가 없다. 가이드 없이는 커뮤니티 플러그인이 생기지 않는다.

## 작업 항목

- "나만의 플러그인 만들기" 10분 가이드 작성
- `@robota-sdk/plugin-template` starter 레포 공개
- 가이드 내용:
  1. 플러그인 구조 (IPlugin 인터페이스)
  2. 이벤트 훅 등록 방법
  3. 설정 파일 연동 방법
  4. npm 배포 및 네이밍 컨벤션 (`@*/robota-plugin-*`)
  5. 테스트 방법
- `robota.io/plugins` 커뮤니티 플러그인 디렉토리 페이지 (curated list)
- 공식 플러그인과 커뮤니티 플러그인 분리 표시

## Test Plan

- plugin-template starter 레포 clone 후 빌드 확인
- 가이드 따라 플러그인 작성 + 등록 확인

## User Execution Test Scenarios

Not applicable — documentation and tooling.
