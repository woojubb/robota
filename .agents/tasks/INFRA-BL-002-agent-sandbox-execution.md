---
title: Agent 샌드박스 실행 환경
status: backlog
created: 2026-03-15
updated: 2026-04-19
priority: medium
urgency: later
---

## What

에이전트가 BashTool, 파일 읽기/쓰기 등의 도구를 실행할 때 호스트 시스템이 아닌 격리된 환경에서 실행되도록 한다.

현재 `BashTool`은 호스트 프로세스에서 직접 실행됨 — 에이전트가 잘못된 명령을 실행하면 실제 파일시스템에 영향을 줌.

## 배경

OpenAI Agents SDK (2026년 4월)가 네이티브 샌드박스 기능을 발표:

- 에이전트가 격리된 워크스페이스 안에서 파일 읽기/쓰기, 셸 명령어 실행
- Unix 파일시스템 권한 기반 세분화된 접근 제어 (read-only / read-write 디렉토리 지정)
- 스냅샷 + 하이드레이션으로 장시간 실행 에이전트 상태 복구

## 검토 중인 실행 플랫폼

| 플랫폼        | 특징                                | 비고                                |
| ------------- | ----------------------------------- | ----------------------------------- |
| AWS Lambda    | 서버리스, 15분 타임아웃, cold start | SDK 패키지 ~300KB — cold start 미미 |
| Fly.io        | 컨테이너 기반, 지속 실행 가능       | WebSocket 지원                      |
| Modal         | GPU/CPU 서버리스, Python 중심       | 코드 실행 특화                      |
| E2B           | 에이전트 코드 실행 전용 샌드박스    | OpenAI 파트너                       |
| Docker (로컬) | 개발 환경용, 가장 간단              | 프로덕션 별도 필요                  |

## SDK 패키지 서버리스 호환성

| 패키지                   | Lambda | 비고                         |
| ------------------------ | ------ | ---------------------------- |
| agent-core               | O      | 순수 로직                    |
| agent-sessions           | O      | `node:path` 사용             |
| agent-sdk                | O      | config 로딩에 `node:fs` 사용 |
| agent-tools              | O      | bash/read/write 정상 동작    |
| agent-provider-anthropic | O      | HTTP only                    |
| agent-cli                | N/A    | 터미널 전용                  |

## 연관 작업

- **SDK-BL-004** (Ralph Loop) — 매 반복마다 클린한 샌드박스에서 시작하면 시너지
- **CLI-BL-017** (완료) — `--bare` 플래그로 경량 실행 가능

## Open Design Questions

1. 샌드박스 경계를 SDK 레벨에서 추상화할지, 사용자가 직접 구성할지
2. 로컬 Docker vs 클라우드 플랫폼 — 개발/프로덕션 분리 전략
3. 파일시스템 권한 제어 API 설계 (read-only paths, write paths 명시)
4. Ralph Loop와 결합 시 워크스페이스 초기화/복구 전략

## Promotion Path

1. Open design questions 답변 후 스펙 작성
2. Branch: `feat/agent-sandbox-execution` (구현 시점에 생성)
