# QA 사전 출시 점검 보고서

**작성일**: 2026-05-10
**대상**: Robota agent-cli 서비스 (agent-cli + agent-server + agent-web)
**점검자**: QA Agent (Claude Sonnet 4.6)

---

## 요약

- 발견된 문제 수: 14
- 심각도별 분류: 🔴 Critical: 2, 🟠 High: 4, 🟡 Medium: 5, 🟢 Low: 3

---

## 심각도 기준

- 🔴 Critical: 서비스 출시 전 반드시 수정해야 하는 문제
- 🟠 High: 가능하면 출시 전 수정, 사용자 경험에 큰 영향
- 🟡 Medium: 출시 후 단기간 내 수정 필요
- 🟢 Low: 출시 후 여유 있을 때 개선

---

## 발견된 문제들

### [QA-001] 실제 API 키가 로컬 .env 파일에 평문 저장됨

- **심각도**: 🔴 Critical
- **위치**:
  - `apps/agent-server/.env:1-8`
  - `packages/agent-cli/.env:1`
- **문제**: `.env` 파일에 실제 운영 API 키가 평문으로 저장되어 있음.
  - `apps/agent-server/.env`: `OPENAI_API_KEY=sk-proj-YsLq...`, `GEMINI_API_KEY=AIzaSy...`, `BYTEDANCE_API_KEY=ae9d99...`
  - `packages/agent-cli/.env`: `ANTHROPIC_API_KEY=sk-ant-api03-3nuZ9...`
  - 두 파일 모두 `.gitignore`에 등록되어 있어 현재 리포지토리에는 커밋되지 않았으나, 로컬 파일시스템에 존재.
- **영향**: 개발자 머신이 노출되거나 파일이 실수로 공유될 경우 API 키 유출. 팀원 간 `.env` 파일 공유 시 즉시 키 유출.
- **권장 조치**:
  1. 모든 실제 키를 즉시 각 제공자 콘솔에서 폐기(revoke)하고 새 키 발급
  2. `.env` 파일에 실제 키 절대 저장 금지 — `.env.example`의 빈 값 패턴 준수
  3. secret manager(예: AWS Secrets Manager, GCP Secret Manager, 1Password) 사용 권고

---

### [QA-002] WebSocket 인증이 토큰 검증 없이 통과됨 (JWT TODO 미구현)

- **심각도**: 🔴 Critical
- **위치**: `apps/agent-server/src/websocket-server.ts:153`
- **문제**: WebSocket `auth` 핸들러에 `// TODO: Validate JWT token here` 주석이 있으며, 실제 토큰 검증 없이 토큰이 비어 있지 않으면 인증 성공 처리됨.
  ```typescript
  // TODO: Validate JWT token here
  // For now, we'll accept any non-empty token
  if (!token) {
    this.sendError(clientId, 'Missing authentication token');
    return;
  }
  ```
- **영향**: 임의의 비어 있지 않은 문자열(예: `"abc"`)을 토큰으로 전송하면 모든 클라이언트가 인증 통과. Playground 실시간 기능이 인증 없이 노출됨.
- **권장 조치**: 실제 JWT 서명 검증 로직 구현 또는 임시로 WebSocket 엔드포인트를 외부 노출 차단. 출시 전 반드시 해결해야 함.

---

### [QA-003] agent-server graceful shutdown 시 활성 연결 종료 없이 즉시 `process.exit(0)` 호출

- **심각도**: 🟠 High
- **위치**: `apps/agent-server/src/server.ts:40-48`
- **문제**: SIGTERM/SIGINT 핸들러가 `process.exit(0)`만 호출하고, HTTP 서버 닫기(`server.close()`), WebSocket 연결 정리(`wsServer.close()`), 진행 중인 AI 스트리밍 요청 완료 대기를 수행하지 않음.
  ```typescript
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0); // 즉시 종료 — 연결 정리 없음
  });
  ```
- **영향**: 배포/재시작 시 스트리밍 응답 중단, WebSocket 연결 강제 종료. 사용자가 응답 중 연결 끊김 경험.
- **권장 조치**: `server.close()` → `wsServer.close()` → 완료 후 `process.exit(0)` 순서로 graceful shutdown 구현. 타임아웃(예: 30초) 내 완료 못 하면 강제 종료.

---

### [QA-004] WebSocket 정리 setInterval이 close() 시 해제되지 않음 (메모리 누수)

- **심각도**: 🟠 High
- **위치**: `apps/agent-server/src/websocket-server.ts:56`, `apps/agent-server/src/websocket-server.ts:312`
- **문제**: 생성자에서 `setInterval(this.cleanupInactiveConnections.bind(this), 30000)`을 호출하지만 반환값을 클래스 필드에 저장하지 않음. `close()` 메서드에서 `clearInterval`을 호출할 수 없어 서버 종료 후에도 인터벌이 계속 실행됨.

  ```typescript
  // 생성자 — interval 반환값 저장 안 함
  setInterval(this.cleanupInactiveConnections.bind(this), 30000);

  // close() 메서드 — clearInterval 없음
  public close(): void {
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.userSessions.clear();
    this.wss.close();
  }
  ```

- **영향**: 서버 재시작 시나 테스트 환경에서 인터벌이 누적되어 메모리 누수 및 이미 닫힌 WebSocket 서버 참조.
- **권장 조치**: `private cleanupInterval: ReturnType<typeof setInterval>` 필드 추가, `close()`에서 `clearInterval(this.cleanupInterval)` 호출.

---

### [QA-005] `promptInput()` 함수가 비-TTY 환경에서 `setRawMode()` 호출 시 크래시 위험

- **심각도**: 🟠 High
- **위치**: `packages/agent-cli/src/cli.ts:99-133`
- **문제**: `promptInput()` 함수가 `stdin.isTTY` 여부를 확인하지 않고 `stdin.setRawMode(true)`를 호출함. `stdin`이 TTY가 아닌 경우(파이프, CI 환경 등) `setRawMode()`는 `TypeError: setRawMode is not a function`을 발생시킴. `--configure` 플래그 사용 시 이 함수를 통해 API 키를 입력받음.
  ```typescript
  function promptInput(label: string, masked = false): Promise<string> {
    return new Promise<string>((resolve) => {
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);  // stdin이 TTY가 아니면 throw
      ...
    });
  }
  ```
- **영향**: CI/CD 환경이나 파이프된 입력에서 `robota --configure` 실행 시 프로세스 크래시. 에러 메시지 없이 종료.
- **권장 조치**: `if (!stdin.isTTY)` 가드 추가, 비-TTY 환경에서는 라인 입력 모드로 대체하거나 명확한 에러 메시지 출력.

---

### [QA-006] agent-server 루트 엔드포인트가 구현되지 않은 API를 광고함

- **심각도**: 🟠 High
- **위치**: `apps/agent-server/src/app.ts:129-131`
- **문제**: `GET /` 응답에 `stream: '/api/v1/remote/stream'`과 `capabilities: '/api/v1/remote/providers/:provider/capabilities'` 엔드포인트를 나열하지만, 이 라우트들이 실제로 구현되어 있지 않음. 실제 등록된 라우트:
  - `GET /api/v1/remote/health` ✅
  - `POST /api/v1/remote/chat` ✅
  - `GET /api/v1/remote/ws/status` ✅
  - `GET /health` ✅
  - `GET /api/v1/remote/stream` ❌ (404)
  - `GET /api/v1/remote/providers/:provider/capabilities` ❌ (404)
- **영향**: API 소비자가 광고된 엔드포인트를 사용하면 404 오류. 문서와 구현 불일치.
- **권장 조치**: 광고 목록에서 미구현 엔드포인트 제거하거나 실제 구현을 추가.

---

### [QA-007] agent-server 테스트 파일 없음

- **심각도**: 🟡 Medium
- **위치**: `apps/agent-server/src/`
- **문제**: `apps/agent-server/src/` 전체에 테스트 파일(`.test.ts`, `.spec.ts`)이 단 하나도 없음. `package.json`에 `"test": "vitest run --passWithNoTests"` 스크립트가 있어 0개의 테스트도 성공으로 처리됨.
  - 테스트 없는 모듈: `app.ts` (라우트 로직), `websocket-server.ts` (연결 관리), `server.ts` (서버 초기화), `utils/env-flags.ts`
- **영향**: WebSocket 인증 버그, 라우트 오류 등이 회귀 테스트로 감지되지 않음.
- **권장 조치**: 최소한 `/api/v1/remote/chat` 라우트, CORS 설정, 에러 핸들러에 대한 통합 테스트 작성.

---

### [QA-008] agent-web 테스트 파일 없음

- **심각도**: 🟡 Medium
- **위치**: `apps/agent-web/src/`
- **문제**: `apps/agent-web/src/` 전체에 테스트 파일이 단 하나도 없음. `package.json`에 jest 설정(`"test": "jest --passWithNoTests"`)이 있으나 실제 테스트 없음.
- **영향**: Next.js 페이지, Playground 통합, API 설정 변경으로 인한 회귀 감지 불가.
- **권장 조치**: Playground 페이지 렌더링 스모크 테스트 및 `src/lib/cache.ts` 유닛 테스트 최소 작성.

---

### [QA-009] agent-server에 unhandledRejection 핸들러 없음

- **심각도**: 🟡 Medium
- **위치**: `apps/agent-server/src/server.ts`
- **문제**: Node.js 프로세스 레벨 `unhandledRejection` 핸들러가 없음. AI 프로바이더 호출 등 비동기 작업에서 처리되지 않은 Promise rejection이 발생하면 Node.js 기본 동작(경고 출력 또는 프로세스 종료)에 의존.
  ```typescript
  // server.ts에 없음:
  // process.on('unhandledRejection', ...)
  ```
- **영향**: 미처리 rejection으로 인한 서버 불안정. 오류 추적 어려움.
- **권장 조치**: `process.on('unhandledRejection', (reason, promise) => { logger.error(...) })` 핸들러 추가.

---

### [QA-010] vitest.config.ts에 coverage threshold 미설정

- **심각도**: 🟡 Medium
- **위치**: `packages/agent-cli/vitest.config.ts`
- **문제**: 커버리지 설정에 임계값(threshold)이 없음. CI에서 커버리지가 아무리 낮아도 빌드가 성공.
  ```typescript
  coverage: {
    provider: 'v8',
    reporter: ['text', 'json', 'html'],
    // threshold 없음
    exclude: ['dist/**', ...],
  }
  ```
- **영향**: 커버리지 하락을 감지할 수 없어 테스트 없는 코드가 배포될 위험.
- **권장 조치**: `lines: 60, branches: 50` 등 최소 임계값 설정.

---

### [QA-011] agent-server `server.ts`가 CJS `require.main` 관용구를 ESM 컨텍스트에서 사용

- **심각도**: 🟡 Medium
- **위치**: `apps/agent-server/src/server.ts:57`
- **문제**: `if (require.main === module)` 조건은 CommonJS 전용 패턴임. tsup 빌드 설정(`format: ['cjs']`)으로 CJS로 컴파일되어 런타임은 동작하나, TypeScript 소스 레벨에서 ESM 관용구(`import.meta.url`)와 불일치하며 tsup 설정 변경 시 즉시 깨짐.
  ```typescript
  if (require.main === module) {
    // CJS 전용
    startServer();
  }
  ```
- **영향**: tsup 설정을 ESM으로 변경하면 즉시 런타임 오류. 일관성 없는 모듈 시스템.
- **권장 조치**: `apps/agent-server/src/server.ts`에서 `require.main` 조건을 제거하고 파일이 직접 실행될 때만 `startServer()`를 호출하도록 별도 `bin.ts` 추가하거나, ESM 방식으로 변환.

---

### [QA-012] agent-cli `cli.ts`의 `--system-prompt` 인수 미연결 (TODO)

- **심각도**: 🟢 Low
- **위치**: `packages/agent-cli/src/cli.ts:340`
- **문제**: `// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field` 주석이 있으며, `--system-prompt` CLI 인수가 파싱되어 있으나 `InteractiveSession` 생성자에 전달되지 않음.
- **영향**: `--system-prompt` 플래그를 사용해도 효과 없음. 사용자 혼란 유발.
- **권장 조치**: 기능 구현 전까지 `--help` 출력에서 해당 옵션을 숨기거나, 미지원 옵션임을 stderr에 경고.

---

### [QA-013] WebSocket `generateClientId()`가 deprecated `substr()` 사용

- **심각도**: 🟢 Low
- **위치**: `apps/agent-server/src/websocket-server.ts:263`
- **문제**: `Math.random().toString(36).substr(2, 9)`는 deprecated `substr` 메서드를 사용함.
  ```typescript
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  ```
- **영향**: 미래 Node.js 버전에서 제거될 수 있음. 또한 `Math.random()` 기반 ID는 암호학적으로 안전하지 않음.
- **권장 조치**: `substring(2, 11)` 또는 `crypto.randomUUID()`로 교체.

---

### [QA-014] agent-cli와 agent-web의 React 버전 불일치

- **심각도**: 🟢 Low
- **위치**: `packages/agent-cli/package.json:88`, `apps/agent-web/package.json`
- **문제**: agent-cli는 `react: "19.2.4"`, agent-web은 `react: "19.1.0"`을 의존함.
- **영향**: 공유 컴포넌트나 동일 패키지를 사용할 경우 예기치 않은 동작 가능. 미래 공유 가능성 고려 시 버전 통일이 바람직.
- **권장 조치**: 모노레포 root 또는 workspace 설정에서 React 버전을 단일 버전으로 통일.

---

## 긍정적인 점 (잘 되어 있는 것)

### 보안

- `.env` 파일이 `.gitignore`에 올바르게 등록되어 있어 Git 커밋 방지됨
- CORS 설정이 명시적 origin 화이트리스트 방식으로 구현됨 (`apps/agent-server/src/app.ts:39-48`)
- Rate limiting이 구현되어 있음 (15분 창, 기본 100 요청)
- `helmet` 미들웨어 적용

### 에러 핸들링

- CLI `bin.ts`의 IME 관련 uncaughtException 핸들러가 정교하게 구현됨 — IME 에러만 억제하고 일반 오류는 재throw
- API 서버의 전역 Express 에러 핸들러가 프로덕션 환경에서 내부 오류 상세 정보를 숨김
- `createProcessResult()`, `ChildProcessSubagentResultController` 등 프로세스 관리 로직에서 타이머 정리 및 이벤트 리스너 해제가 명시적으로 처리됨

### TypeScript 품질

- `tsconfig.base.json`에 `strict: true`, `noImplicitAny: true`, `strictNullChecks: true` 등 엄격한 설정 적용
- agent-cli 소스 전체에서 `any` 타입 사용 없음 (grep 결과 0건)
- 인터페이스와 타입 사용이 일관됨

### 테스트 커버리지 (agent-cli)

- agent-cli에 53개의 테스트 파일이 존재하며 UI 컴포넌트(ink-testing-library), 유틸리티, 서브에이전트, E2E 스타일 테스트를 포함
- 스트리밍 abort E2E 테스트 (`abort-streaming-e2e.test.tsx`)가 실제 사용자 경험을 시뮬레이션함
- 디바운싱, 권한 큐, CJK 입력 등 복잡한 상호작용에 대한 단위 테스트가 존재

### CJK 입력 처리

- `CjkTextInput.tsx`가 ref 기반 상태 관리로 IME 입력의 React 배치 업데이트 문제를 올바르게 해결
- `applyCjkFlowSafely()`의 try/catch로 IME 바이트 시퀀스 오류를 안전하게 처리
- `setCursorPosition()` 미호출로 Terminal.app SIGSEGV 방지 (의도적 설계)

### 메모리 관리

- `useInteractiveSession.ts`의 `useEffect` 클린업에서 모든 이벤트 리스너를 명시적으로 해제
- `WaveText.tsx`의 `setInterval`이 `useEffect` 클린업에서 `clearInterval`로 올바르게 해제
- `TuiStateManager`의 스트리밍 디바운스 타이머가 `onComplete`/`onInterrupted`에서 flush됨

### 빌드 설정

- `prepublishOnly` 훅이 `check-pnpm-publish.sh` 스크립트를 실행하여 publish 안전성 확보
- `engines.node >= 22.0.0` 명시로 지원 환경 명확화
- tsup 빌드에서 `dist/node/bin.cjs` 등 불필요한 CJS 파일 자동 삭제

---

## 점검하지 못한 영역

| 영역                                  | 이유                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| agent-core, agent-sdk 내부 로직       | 점검 범위 외 (별도 SPEC.md 및 테스트 존재)                                         |
| 실제 AI 프로바이더 API 호출 오류 처리 | 각 provider 패키지 내부 로직, 실제 네트워크 필요                                   |
| agent-playground 패키지 코드          | 직접 점검하지 않음                                                                 |
| Firebase Functions 배포 설정          | `apps/agent-server/src/index.ts` 확인했으나 Firebase 환경 변수 및 배포 설정 미검증 |
| 실제 CI/CD 파이프라인                 | GitHub Actions 워크플로우 미확인                                                   |
| 성능 벤치마크                         | 정량적 측정 도구 미실행                                                            |
| 접근성(a11y)                          | CLI TUI 환경에는 해당 없으며, agent-web 미테스트                                   |

---

## 우선순위 요약

출시 전 필수 수정:

1. **[QA-001]** 로컬 `.env` 파일의 실제 API 키 즉시 폐기 및 키 관리 정책 수립
2. **[QA-002]** WebSocket JWT 토큰 검증 구현 또는 엔드포인트 외부 차단

출시 전 강력 권고: 3. **[QA-003]** agent-server graceful shutdown 구현 4. **[QA-004]** WebSocket 정리 setInterval 누수 수정 5. **[QA-005]** `promptInput()` 비-TTY 가드 추가 6. **[QA-006]** 미구현 API 엔드포인트 광고 제거
