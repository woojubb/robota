---
title: 'CLI-017: Node.js 요구 사항 Node 20 LTS로 낮추기 또는 22+ 이유 문서화'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---

## Background

`packages/agent-cli/package.json`의 `engines.node`가 `>=22.0.0`으로 설정되어 있다. SDK는 `>=18.0.0`을 지원한다고 명시되어 있어 CLI와 SDK 간 요구 사항이 불일치한다.

npm 생태계에서 Node.js 20 LTS는 2026년까지 유지 보수되는 가장 일반적인 환경이다. `npx @robota-sdk/agent-cli` 실행 시 Node 20 LTS 사용자가 즉시 오류를 마주친다.

## 작업 항목

**선택지 A: Node 20 LTS로 요구 사항 낮추기**

- `engines.node`를 `>=20.0.0`으로 변경
- Node 22 전용 API(`fs.glob`, `--experimental-*` 등)가 실제로 사용되는지 코드 전수 확인
- 사용 중이라면 Node 20 호환 대안으로 교체

**선택지 B: Node 22+ 요구 이유 문서화**

- CLI README에 "Node.js 22+ 필요 이유: `<구체적 기능>`" 명시
- `getting-started` 문서에 Node 버전 체크 안내 추가
- 에러 메시지에 Node 버전 요구 사항 안내 개선 (`bin/robota.cjs`의 버전 체크 메시지)

## Test Plan

- Node 20 LTS 환경에서 `npx @robota-sdk/agent-cli` 정상 실행 확인 (선택지 A)
- 또는 Node 20에서 실행 시 명확한 안내 메시지 출력 확인 (선택지 B)
- `pnpm typecheck` 및 `pnpm test` 통과 확인

## User Execution Test Scenarios

### Scenario 1: Node 20 환경에서 실행

```bash
# Node 20 환경
node --version  # v20.x.x

npx @robota-sdk/agent-cli
```

Expected (A): 정상 실행  
Expected (B): 명확한 버전 요구 안내 메시지 출력
