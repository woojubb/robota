---
title: 'CLI-033: Headless E2E 통합 테스트 수트 확장'
status: done
created: 2026-05-24
priority: medium
urgency: soon
area: packages/agent-cli
depends_on: []
---

## Background

현재 `@robota-sdk/agent-cli`는 4개의 integration test 파일만 있다 (senior-dev-report 기준). Unit test로는 CLI의 핵심 가치인 "실제 AI와 협업하여 작업을 수행하는" 경험을 검증할 수 없다.

특히:

- `--system-prompt` 기능이 문서와 다르게 동작해도 unit test로는 감지 불가
- Permission 프롬프트 플로우가 특정 환경에서 깨져도 감지 불가
- `-p` (print/headless) 모드의 end-to-end 동작이 regression 없이 변경될 수 있음

headless 모드(`-p`)는 실제 UI 없이 실행 가능해서 E2E 테스트가 가능하다.

## 작업 항목

### 필수 E2E 시나리오 (headless mode 대상)

1. **기본 프롬프트 실행**: `-p "What is 2+2"` → 숫자 포함 응답 확인
2. **--system-prompt 반영**: `-p "Respond" --system-prompt "Always respond in Korean"` → 한국어 응답 확인
3. **--append-system-prompt 반영**: 원본 프롬프트 + append 내용이 모두 반영되는지
4. **--max-tokens 제한**: 짧은 응답 생성 → 지정한 max 이하인지 확인
5. **파일 입력**: stdin 또는 `--file` 플래그로 파일 내용 전달
6. **exit code**: 성공 시 0, 오류 시 1
7. **Node < 22 감지**: mock process.version → 버전 오류 메시지 확인

### 구현 방식

- `vitest` + 실제 프로세스 spawn (`child_process.spawn`)
- Mock AI provider 또는 실제 provider (환경변수 체크)
- `CI=true` 환경에서 자동 실행
- `pnpm test:e2e` 스크립트 추가

## 성공 기준

- 7개 E2E 시나리오 모두 통과
- `pnpm test:e2e`로 독립 실행 가능
- CI 파이프라인에 포함
- regression 방지: 기존 기능 변경 시 관련 E2E가 깨짐으로써 감지
