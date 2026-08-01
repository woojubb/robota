---
title: Context overflow when executing plugin skills with many file reads
status: completed
priority: high
created: 2026-03-23
packages:
  - agent-sessions
  - agent-sdk
---

## 문제

플러그인 skill (e.g., `/rulebased-harness:audit`) 실행 시 AI가 많은 파일을 읽으면서 "No response received. The context window may be full." 오류 발생. Context 29% (291K/1M)에서 발생 — output token limit 또는 auto-compact 미작동 의심.

## 기존 메커니즘

- auto-compact가 context threshold 초과 시 자동 압축하는 기능이 이미 구현되어 있음
- 이 매커니즘이 plugin skill 실행 중에 제대로 작동하지 않은 것으로 보임

## 조사 필요

- auto-compact threshold 설정 확인
- plugin skill 실행 중 tool call이 많을 때 compact 트리거 조건 확인
- max output token 제한이 원인인지 확인
