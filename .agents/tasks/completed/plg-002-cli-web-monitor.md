# PLG-002: CLI Second Screen — Browser Monitor

- **Status**: done
- **Created**: 2026-05-10
- **Closed**: 2026-05-10
- **Branch**: feat/plg-002-cli-web-monitor (merged via PR #365)
- **Scope**: packages/agent-cli, packages/agent-web (신규), apps/agent-web

## Objective

`agent-cli`에 `--web` 플래그를 추가해 실행 중인 `InteractiveSession`을 WebSocket으로 노출하고,
브라우저(`apps/agent-web /monitor`)가 실시간으로 대화 현황을 시각화하는 보조 화면을 구현한다.
Phase 1: 읽기 전용 모니터. Phase 2: 양방향 입력 지원.

## Plan

- [x] 브랜치 생성 + 태스크 파일
- [x] agent-cli: --web/--web-port 플래그 + sidecar WS 서버
- [x] packages/agent-web 신규 패키지 (WS 클라이언트 + SessionMonitor)
- [x] apps/agent-web: /monitor 페이지 추가
- [x] 빌드 + 타입체크 + 검증

## Result

- `--web` / `--web-port` 플래그 구현 및 WS sidecar 서버 동작 확인
- `packages/agent-web` React 라이브러리 신규 생성
- `apps/agent-web /monitor` 페이지 구현
- PR #365로 develop merge 완료

## Known Limitation (→ PLG-003)

`--web` 실행 시 브라우저는 열리지만 `apps/agent-web` Next.js 서버가 별도로 실행 중이어야 페이지가
표시됨. CLI가 독립적으로 동작하려면 Next.js 의존성 제거 및 번들 내장 서버 방식으로 전환 필요.
후속 작업은 PLG-003으로 분리.
