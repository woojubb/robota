---
title: 'ARCH-FIX-010: bundle-plugin-loader.ts 제품명 및 fallback 경로 패턴 제거'
status: done
created: 2026-05-10
priority: medium
urgency: backlog
area: code-quality
related: [V-SYS-007]
---

## Problem

`bundle-plugin-loader.ts`에서 세 가지 규칙 위반이 발견됐다:

1. **fallback 경로 패턴**: `.mcp.json` → `.claude-plugin/mcp.json` 순서로 fallback 탐색
2. **silent catch**: 파일 읽기 실패 시 예외를 조용히 무시
3. **제품명 하드코딩**: `Claude Code standard` 문자열이 코드에 직접 포함

`operational.md` no-fallback 정책, `naming-style.md` 제품명 금지 규칙 위반이다.

## Solution

1. fallback 경로 탐색을 제거하고 단일 설정 파일 경로만 사용한다.
2. 파일 읽기 실패 시 명시적 에러를 throw하거나 사용자에게 명확한 메시지를 제공한다.
3. `Claude Code standard` 문자열을 generic한 설명 또는 상수로 교체한다.
4. 필요하다면 설정 파일 경로를 하드코딩 대신 주입받는 방식으로 변경한다.

## Test Plan

- `bundle-plugin-loader.ts`에 `Claude Code` 문자열 없음 확인 (`rg 'Claude Code' packages/`)
- fallback 경로 탐색 로직 없음 확인
- silent catch 없음 확인
- `pnpm --filter @robota-sdk/agent-sdk test` 통과

## User Execution Test Scenarios

### 시나리오: 잘못된 플러그인 설정 파일 경로 지정 시 명시적 에러 확인

**전제 조건**: Node.js 22+, 빌드 완료

**실행 단계**: 존재하지 않는 플러그인 설정으로 CLI 실행

**기대 결과**: silent fallback 없이 명시적 에러 메시지 출력.

**증거**: (구현 후 기록)
