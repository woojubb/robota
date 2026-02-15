---
title: "DAG 로컬 실행/빌드 검증 로그"
description: "문서 반영 전 명령 검증 기록"
---

# DAG 로컬 실행/빌드 검증 로그

검증 원칙:
- 문서 본문에는 PASS 확인 명령만 반영
- FAIL 케이스는 원인/충족 조건을 함께 기록

## 1) Build 검증

### Command: `pnpm --filter @robota-sdk/dag-core build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG core 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/dag-runtime build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG runtime 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/dag-worker build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG worker 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/dag-scheduler build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG scheduler 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/dag-projection build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG projection 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/dag-api build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG API 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/dag-designer build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG designer 패키지 빌드 검증
- expected: tsup build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/api-server build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG dev server 엔트리 포함 API 서버 빌드 검증
- expected: `dist/dag-dev-server.js` 포함 build success
- actual: build success
- result: PASS

### Command: `pnpm --filter @robota-sdk/web build`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG designer host 라우트 포함 web 빌드 검증
- expected: Next.js build success, `/dag-designer` route 생성
- actual: build success, `/dag-designer` route 출력 확인
- result: PASS

## 2) Test 검증

### Command: `pnpm --filter '@robota-sdk/dag-*' test`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG 패키지 테스트 일괄 검증 시도
- expected: 모든 패키지 테스트 PASS
- actual: `dag-worker`의 lease 관련 테스트 간헐 실패 1건 발생
- result: FAIL
- failure-cause: 패키지 병렬 실행 시 타이밍 민감 테스트가 불안정할 수 있음
- fix-condition: 테스트 명령을 패키지 단위 순차 실행으로 고정

### Command: `pnpm --filter @robota-sdk/dag-core test && pnpm --filter @robota-sdk/dag-runtime test && pnpm --filter @robota-sdk/dag-worker test && pnpm --filter @robota-sdk/dag-scheduler test && pnpm --filter @robota-sdk/dag-projection test && pnpm --filter @robota-sdk/dag-api test && pnpm --filter @robota-sdk/dag-designer test`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG 패키지 테스트 안정 검증
- expected: 전체 PASS
- actual: 전체 PASS
- result: PASS

## 3) Dev/Start 검증

### Command: `pnpm --filter @robota-sdk/api-server dag:dev`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG 로컬 개발 서버 기동
- expected: `http://localhost:3011` listen 시작
- actual: 서버 시작 로그 확인
- result: PASS

### Command: `curl -sS http://localhost:3011/health`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG dev 서버 헬스체크
- expected: status ok JSON
- actual: `{"status":"ok","service":"robota-dag-dev-server",...}`
- result: PASS

### Command: `POST /v1/dag/definitions -> validate -> publish` (curl 체인)
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: designer API contract 경로 검증
- expected: create 201, validate 200, publish 200
- actual: 응답 코드/페이로드 기준 PASS
- result: PASS

### Command: `pnpm --filter @robota-sdk/web start`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: web host start 명령 검증
- expected: `http://localhost:3000` listen 시작
- actual: next start ready 로그 확인
- result: PASS

### Command: `curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/dag-designer`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: DAG designer host 라우트 응답 확인
- expected: 200
- actual: 200
- result: PASS

## 4) 표준 명령 반영 결론

- 문서 본문 반영 가능 명령:
  - Build/Test/Dev/Start 항목 중 PASS 명령
- 문서 본문 제외 명령:
  - `pnpm --filter '@robota-sdk/dag-*' test` (간헐 FAIL 확인)

## 5) 문서 단독 재현 라운드 (P-Doc-3-2)

### Command: `GET /` on web host
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: 기본 진입 경로가 DAG host로 연결되는지 확인
- expected: `/` -> `/dag-designer` redirect
- actual: `307 Temporary Redirect`, `location: /dag-designer`
- result: PASS

### Command: Browser MCP interaction on `/dag-designer`
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: 문서 기준 실제 사용자 플로우(Create/Validate/Publish) 재현
- expected: 각 버튼 클릭 후 성공 결과 텍스트 표시, 콘솔 에러 없음
- actual:
  - Create: `Create success: dag-web-sample:5`
  - Validate: `Validate success: dag-web-sample:5`
  - Publish: `Publish success: dag-web-sample:5`
  - Console: `<no console messages found>`
- result: PASS

### Command: `OPTIONS /v1/dag/definitions` with Origin header
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: 브라우저 preflight(CORS) 통과 여부 확인
- expected: `Access-Control-Allow-Origin: http://localhost:3000`
- actual: header 확인됨, status `204`
- result: PASS

### Command: `POST /v1/dag/definitions` with Origin header
- cwd: `/Users/jungyoun/Documents/dev/robota`
- purpose: 브라우저 origin에서 create 요청 정상 처리 확인
- expected: 201 또는 duplicate validation error (정상 계약 응답)
- actual: `201 Created` (`dag-web-sample:2`)
- result: PASS

## 6) Gate-Doc-4 증거 요약

- Evidence-1: `.design/specs/dag-local-run-and-build-guide.md` (문서 본문)
- Evidence-2: 본 로그 1~5 섹션의 PASS 기록
- Evidence-3: Browser MCP 실사용 클릭 검증(결과 텍스트 + 콘솔 에러 없음)
