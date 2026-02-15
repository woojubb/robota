---
title: "DAG 로컬 실행/빌드 가이드"
description: "Robota DAG를 로컬에서 빌드, 테스트, 실행, 웹 연동까지 검증하는 실사용 가이드"
---

# DAG 로컬 실행/빌드 가이드

이 문서는 Robota DAG를 로컬 환경에서 재현 가능한 방식으로 실행하기 위한 가이드입니다.  
여기 포함된 명령은 `.design/specs/dag-local-run-build-validation-log.md`에서 검증된 명령만 반영합니다.

## 1) 전제 조건

- Node.js: `>=18` (workspace는 `pnpm@8.15.4` 기준)
- pnpm 설치 완료
- 저장소 루트에서 의존성 설치 완료:

```bash
pnpm install --no-frozen-lockfile
```

## 2) 환경 변수 설정

### 2.1 API 서버 (`apps/api-server`)

`apps/api-server/.env.example`를 기준으로 `.env`를 준비합니다.

필수(로컬 DAG dev 기준):
- `DAG_DEV_PORT` (기본값: `3011`)

선택:
- `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `RATE_LIMIT_MAX`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (remote API 사용 시)

### 2.2 Web host (`apps/web`)

`apps/web/.env.dag.example`를 기준으로 `.env.local`을 준비합니다.

필수:
- `NEXT_PUBLIC_DAG_API_BASE_URL=http://localhost:3011`

선택:
- `NEXT_PUBLIC_API_VERSION=v1`

## 3) 표준 Build 명령

아래 명령은 순서대로 실행합니다.

```bash
pnpm --filter @robota-sdk/dag-core build
pnpm --filter @robota-sdk/dag-runtime build
pnpm --filter @robota-sdk/dag-worker build
pnpm --filter @robota-sdk/dag-scheduler build
pnpm --filter @robota-sdk/dag-projection build
pnpm --filter @robota-sdk/dag-api build
pnpm --filter @robota-sdk/dag-designer build
pnpm --filter @robota-sdk/api-server build
pnpm --filter @robota-sdk/web build
```

## 4) 표준 Test 명령

테스트는 안정성을 위해 패키지 단위 순차 실행을 사용합니다.

```bash
pnpm --filter @robota-sdk/dag-core test
pnpm --filter @robota-sdk/dag-runtime test
pnpm --filter @robota-sdk/dag-worker test
pnpm --filter @robota-sdk/dag-scheduler test
pnpm --filter @robota-sdk/dag-projection test
pnpm --filter @robota-sdk/dag-api test
pnpm --filter @robota-sdk/dag-designer test
```

주의:
- 다음 명령은 표준 경로로 사용하지 않습니다(간헐 실패 가능성 확인됨):

```bash
pnpm --filter '@robota-sdk/dag-*' test
```

## 5) 로컬 실행 (CLI 경로)

### 5.1 DAG dev 서버 시작

```bash
pnpm --filter @robota-sdk/api-server dag:dev
```

헬스체크:

```bash
curl -sS "http://localhost:3011/health"
```

### 5.2 샘플 정의 생성/배포

샘플 DAG를 생성/검증/배포합니다.

```bash
curl -sS -X POST "http://localhost:3011/v1/dag/definitions" \
  -H "Content-Type: application/json" \
  -d '{"definition":{"dagId":"dag-web-sample","version":1,"status":"draft","nodes":[{"nodeId":"entry","nodeType":"input","dependsOn":[],"config":{}},{"nodeId":"processor","nodeType":"processor","dependsOn":["entry"],"config":{}}],"edges":[{"from":"entry","to":"processor"}]}}'

curl -sS -X POST "http://localhost:3011/v1/dag/definitions/dag-web-sample/validate" \
  -H "Content-Type: application/json" \
  -d '{"version":1}'

curl -sS -X POST "http://localhost:3011/v1/dag/definitions/dag-web-sample/publish" \
  -H "Content-Type: application/json" \
  -d '{"version":1}'
```

### 5.3 DAG run 실행

```bash
curl -sS -X POST "http://localhost:3011/v1/dag/dev/runs" \
  -H "Content-Type: application/json" \
  -d '{"dagId":"dag-web-sample","input":{"hello":"world"}}'
```

응답에서 `dagRunId`를 확인하고, worker를 수동으로 진행합니다.

```bash
curl -sS -X POST "http://localhost:3011/v1/dag/dev/workers/process-once" \
  -H "Content-Type: application/json" \
  -d '{}'
```

필요 횟수만큼 반복 후 상태 조회:

```bash
curl -sS "http://localhost:3011/v1/dag/dev/runs/<dagRunId>"
curl -sS "http://localhost:3011/v1/dag/dev/observability/<dagRunId>/dashboard"
```

## 6) 로컬 실행 (Web host 경로)

### 6.1 Web host 시작

```bash
pnpm --filter @robota-sdk/web start
```

### 6.2 DAG 디자이너 경로 확인

브라우저에서 `http://localhost:3000/dag-designer` 접속  
또는 상태 코드 확인:

```bash
curl -sS -o /dev/null -w "%{http_code}" "http://localhost:3000/dag-designer"
```

정상 상태는 `200`입니다.

추가 확인:
- `http://localhost:3000/` 접속 시 기본 경로는 `/dag-designer`로 리다이렉트됩니다.

페이지에서 다음 동작을 확인할 수 있습니다.
- `Create Draft`
- `Validate`
- `Publish`

## 7) 운영 경계/정책

- `dag-designer`는 SDK 패키지이며 단독 서버가 아닙니다. 반드시 host app(`apps/web`)에서 렌더합니다.
- 기본 정책은 no-fallback입니다.
  - `retryEnabled=false`
  - `reinjectEnabled=false`
- 실패 시 임시 우회 명령을 추가하지 않고, 누락 조건/실패 원인을 먼저 수정합니다.

## 8) 트러블슈팅

### 포트 충돌 (`EADDRINUSE`)
- 증상: `3011` 또는 `3000` 포트 사용 중
- 조치:
  1. 포트 점유 프로세스 확인
  2. 기존 프로세스 종료 후 재실행

### API 모듈 해석 실패 (`Cannot find module @robota-sdk/dag-core`)
- 증상: `dag:dev` 시작 실패
- 조치:
  1. 저장소 루트에서 `pnpm install --no-frozen-lockfile`
  2. 다시 `pnpm --filter @robota-sdk/api-server dag:dev`

### CORS preflight 차단 (`No 'Access-Control-Allow-Origin' header`)
- 증상: `/dag-designer`에서 버튼 클릭 시 `Failed to fetch` + CORS 오류
- 조치:
  1. `apps/api-server/.env`의 `CORS_ORIGINS`에 `http://localhost:3000` 포함 여부 확인
  2. `pnpm --filter @robota-sdk/api-server dag:dev` 재시작
  3. `OPTIONS /v1/dag/definitions` 응답에 `Access-Control-Allow-Origin` 헤더 확인

### 정의 생성 실패 (예: `DAG_VALIDATION_*`)
- 증상: create/validate/publish 응답이 `ok:false`
- 조치:
  1. 요청 body의 `dagId`, `version`, `nodes`, `edges` 구조 확인
  2. validate 응답의 `code`를 기준으로 입력 수정
