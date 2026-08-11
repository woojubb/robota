---
title: 오케스트레이션 CLI 도구
status: completed
urgency: later
created: 2026-03-15
branch: feat/dag-orchestration-cli
---

## 요약

오케스트레이션 API를 CLI로 제어할 수 있는 커맨드라인 도구.

## 기능

### DAG 오케스트레이션

- `robota-dag definitions list` — DAG 정의 목록 조회
- `robota-dag definitions get <dagId>` — DAG 정의 조회
- `robota-dag definitions create --file <definition.json>` — DAG 정의 생성
- `robota-dag definitions publish <dagId>` — DAG 정의 발행
- `robota-dag nodes list` — 노드 카탈로그 조회
- `robota-dag runs create --file <definition.json>` — 실행 준비 생성
- `robota-dag runs start <preparationId>` — 실행 시작
- `robota-dag runs status <dagRunId>` — 실행 상태 확인
- `robota-dag runs result <dagRunId>` — 실행 결과 조회

### 명시적 제외 범위

- Agent 제어 명령은 `agent-cli`/agent command layer 소관이며 DAG CLI에 포함하지 않는다.
- 비용 추정 명령은 cost API 계약이 별도 정리된 뒤 후속 backlog로 다룬다.

## AI 에이전트 사용

- CLI는 사람뿐 아니라 AI 에이전트가 도구로 이용할 수 있음
- 에이전트가 shell에서 `robota-dag runs create/start` 등을 실행하여 DAG를 제어하는 시나리오
- MCP 서버와 상호보완: MCP는 네이티브 도구 연동, CLI는 shell 기반 범용 연동

## 패키지 구조

- `@robota-sdk/dag-cli`
- 오케스트레이션 API 클라이언트 재사용 (dag-designer의 designer-api-client 참고)

## 권장 구현안

- 별도 패키지 `@robota-sdk/dag-cli`를 추가한다. 기존 `agent-cli`는 agent TUI 전용 얇은 UI 계약이 있으므로 DAG 운영 명령을 섞지 않는다.
- 기본 출력은 JSON으로 둔다. 사람이 읽는 UI보다 에이전트/스크립트 호출 안정성을 우선한다.
- API 서버는 `--server-url` 또는 `ROBOTA_DAG_SERVER_URL`로 지정하고, 기본값은 로컬 `http://localhost:3012`로 둔다.
- 첫 slice는 정의/노드/런의 핵심 REST 호출을 다룬다: definitions list/get/create/publish, nodes list, runs create/start/status/result.

## Plan

- [x] 기존 agent-cli, dag-designer API client, orchestrator-server route 계약 조사
- [x] `@robota-sdk/dag-cli` SPEC/README/package scaffold 추가
- [x] RED 테스트: commands가 올바른 HTTP 요청과 JSON 출력을 생성하는지 검증
- [x] 구현: API client, command parser/runner, bin entrypoint
- [x] 프로젝트 구조/changeset/문서 동기화
- [x] 빌드/test/typecheck/lint/harness 검증 후 completed 이동

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인

## Progress

### 2026-05-05

- ORCH-BL-004 완료 후 `develop`에서 `feat/dag-orchestration-cli` 브랜치 생성.
- `agent-cli`는 agent TUI 전용 thin CLI로 유지하고, DAG 운영 CLI는 별도 `dag-cli` 패키지로 분리하기로 결정.
- `@robota-sdk/dag-cli` 스캐폴드와 SPEC/README를 추가하고, `runDagCli` RED 테스트가 `runner.js` 부재로 실패하는 것을 확인.
- API client, JSON parser/output, command dispatcher, `robota-dag` bin entrypoint를 구현.
- `pnpm install`로 새 workspace package의 lockfile/symlink를 갱신.
- targeted test/typecheck/lint/build를 통과시키고, project structure와 changeset config를 갱신.
- `pnpm docs:build`, `pnpm harness:scan`, `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`, `git diff --check` 통과.

## Result

- 별도 `@robota-sdk/dag-cli` 패키지를 추가해 `robota-dag` JSON-first CLI를 제공.
- 지원 명령: `definitions list/get/create/publish`, `nodes list`, `runs create/start/status/result`.
- CLI는 `--server-url`, `ROBOTA_DAG_SERVER_URL`, `http://localhost:3012` 순서로 서버 URL을 결정.
- `agent-cli`에는 DAG 운영 명령을 추가하지 않고, DAG API 계약 소비자 패키지로 경계를 분리.
