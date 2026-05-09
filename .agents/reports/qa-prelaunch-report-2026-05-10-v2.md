# QA Pre-launch Report — Robota CLI (2026-05-10 v2)

**Date**: 2026-05-10
**Scope**: agent-cli (packages/agent-cli), agent-server (apps/agent-server), agent-web (apps/agent-web)
**Reviewer**: QA Agent (Claude Sonnet 4.6)
**Based on**: Code inspection — new issues only (previous issues in qa-prelaunch-report-2026-05-10.md excluded)

---

## Executive Summary

- New issues found: **10**
- Critical: **1**
- High: **3**
- Medium: **4**
- Low: **2**

Previous report (v1) covered 14 issues (QA-001 through QA-014). This report identifies 10 additional issues not covered in v1. Notably, the two Critical issues from v1 (real API keys in .env, JWT auth bypass) have been updated in the codebase — JWT verification now uses `jsonwebtoken` with a `JWT_SECRET` env var (websocket-server.ts:176-192), and the `promptInput()` non-TTY crash (QA-005) has been fixed with an `isTTY` guard (cli.ts:105-115).

---

## Critical Issues (출시 차단)

### QA-C-001: `--output-format` CLI 인수가 검증 없이 캐스팅되어 잘못된 값 시 동작 undefined

**위치**: `packages/agent-cli/src/cli.ts:378`

**현상**:

```typescript
outputFormat: (args.outputFormat as 'text' | 'json' | 'stream-json') ?? 'text',
```

`--output-format`에 임의 문자열(예: `--output-format xml`)을 전달해도 TypeScript `as` 캐스팅으로 인해 오류 없이 통과되고, `createHeadlessTransport`에 그대로 전달된다.

`packages/agent-transport-headless/src/headless-runner.ts:50-57`에서:

```typescript
if (outputFormat === 'text') { return runTextFormat(...); }
if (outputFormat === 'json') { return runJsonFormat(...); }
return runStreamJsonFormat(session, prompt);  // 알 수 없는 값이면 stream-json으로 폴백
```

인식 불가 포맷은 경고 없이 `stream-json` 모드로 폴백되어 사용자가 인지하지 못한 채 잘못된 형식의 출력이 발생한다.

**재현 방법**:

```bash
robota -p "hello" --output-format xml
```

`xml`을 지정했는데 stream-json 형식으로 출력됨.

**기대 동작**: 지원하지 않는 포맷 값에 대해 명확한 오류 메시지 출력 후 `process.exit(1)`.

**수정 방안**: `cli-args.ts`의 `parseCliArgs()`에 `parseOutputFormat()` 함수 추가 (기존 `parsePermissionMode()`와 동일한 패턴):

```typescript
const VALID_OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
export function parseOutputFormat(
  raw: string | undefined,
): 'text' | 'json' | 'stream-json' | undefined {
  if (raw === undefined) return undefined;
  if (!VALID_OUTPUT_FORMATS.includes(raw as 'text')) {
    process.stderr.write(`Invalid --output-format "${raw}". Valid: text | json | stream-json\n`);
    process.exit(1);
  }
  return raw as 'text' | 'json' | 'stream-json';
}
```

---

## High Issues (출시 전 수정 권장)

### QA-H-001: `--language` CLI 플래그가 인터랙티브 TUI 모드에서 완전히 무시됨

**위치**:

- `packages/agent-cli/src/ui/render.tsx:26` — `IRenderOptions`에 `language?: string` 선언됨
- `packages/agent-cli/src/ui/App.tsx:39-58` — `IProps` 인터페이스에 `language` 필드 없음
- `packages/agent-cli/src/cli.ts:395` — `language: args.language`가 `renderApp()`에 전달됨

**현상**:
`renderApp(options)` 호출 시 `<App {...options} />` 로 스프레드되지만, `App.tsx`의 `IProps`에 `language`가 없어 컴포넌트가 이를 수신하지 않는다. `InteractiveSession`은 `language` 옵션 자체를 받지 않고(`IInteractiveSessionStandardOptions`에 해당 필드 없음) 설정 파일(`settings.json`)에서만 읽는다.

결과적으로 `robota --language ko`로 시작해도 세션 언어는 변경되지 않는다. 사용자가 플래그를 사용해도 효과가 없어 혼란을 유발한다.

**재현 방법**:

```bash
robota --language ko
# 설정 파일에 language가 없는 경우 AI가 한국어로 응답하지 않음
```

**기대 동작**: `--language ko` 플래그가 해당 세션의 언어를 설정해야 함.

**수정 방안**:

1. `App.tsx`의 `IProps`에 `language?: string` 추가
2. `useInteractiveSession`에 전달하거나, 설정 파일을 임시 override하는 방식 선택
3. 단기: `--help`에서 `--language` 플래그 설명에 "applies to interactive setup only" 또는 "applies after restart" 명시

---

### QA-H-002: 슬래시 커맨드 실행 직후 `getContextState()` 호출이 미초기화 세션에서 throw

**위치**: `packages/agent-cli/src/ui/hooks/useSlashRouting.ts:74`

**현상**:

```typescript
const ctx = interactiveSession.getContextState(); // try-catch 없음
```

`applySystemCommandResult()` 함수에서 `getContextState()`를 보호 없이 호출한다. `InteractiveSession.getContextState()`는 내부적으로 `getSessionOrThrow()`를 호출하고, 세션이 아직 초기화되지 않았으면 `Error('InteractiveSession not initialized...')`를 throw한다 (`packages/agent-sdk/src/interactive/interactive-session.ts:340-343`).

앱 시작 직후 (세션 초기화 전) 슬래시 커맨드(예: `/help`)를 빠르게 입력하면 unhandled exception이 발생할 수 있다.

**재현 방법**:
앱 시작 직후 즉시 `/help` 입력 (타이밍 의존).

**기대 동작**: 미초기화 상태에서는 기본 컨텍스트 상태(0%)를 사용하거나 오류 없이 처리.

**수정 방안**:

```typescript
try {
  const ctx = interactiveSession.getContextState();
  manager.setContextState({ ... });
} catch {
  // Session not yet initialized — skip context update
}
```

---

### QA-H-003: Firebase Functions entry point(`index.ts`)에서 `any` 타입 사용 및 이중 CORS 적용

**위치**: `apps/agent-server/src/index.ts:28`

**현상**:

1. **`any` 타입 사용**: Firebase Functions health check 핸들러가 `(req: any, res: any)` 타입으로 선언되어 있다. 이는 프로젝트 전체의 `strict: true`, `noImplicitAny: true` 규칙(tsconfig.base.json)을 위반한다.

2. **이중 CORS 적용**: `index.ts`의 Firebase Functions에서 `cors: true`가 설정되고(`index.ts:14, 23`), `createApp()` 내부에서 `cors` 미들웨어가 또 한 번 적용된다(`app.ts:39`). Firebase `cors: true`는 Firebase가 자체적으로 모든 origin을 허용하도록 설정하므로 `app.ts`의 화이트리스트(`robota.io` 등)가 무력화된다.

**영향**: CORS 정책이 의도와 달리 모든 origin에 열려 API가 노출됨.

**수정 방안**:

- `index.ts`에서 `cors: false`로 변경하여 Express의 CORS 미들웨어만 동작하도록 수정
- `req: any, res: any` → `req: Request, res: Response` (firebase-functions 타입 사용)

---

## Medium Issues (출시 후 단기간 내 수정)

### QA-M-001: agent-server 미사용 의존성 — `express-winston`, `winston`, `@robota-sdk/agent-provider-bytedance`

**위치**: `apps/agent-server/package.json`

**현상**:
`package.json`에 다음 의존성이 선언되어 있으나 `src/` 디렉토리 내 어디에서도 import되지 않는다:

- `express-winston: "^4.2.0"` — 미사용
- `winston: "^3.11.0"` — 미사용
- `@robota-sdk/agent-provider-bytedance` — 미사용 (app.ts에서 BYTEDANCE_API_KEY/BytedanceProvider 참조 없음)

설치/번들 크기가 증가하고, `bytedance` 의존성은 이전 리포트(QA-001)에서 언급된 실제 ByteDance API 키(`BYTEDANCE_API_KEY=ae9d99...`)와 연관될 수 있어 사용 의도 불명확.

**수정 방안**: 미사용 패키지를 `package.json`에서 제거. ByteDance 프로바이더를 실제 지원할 계획이면 `app.ts`에 해당 로직 추가.

---

### QA-M-002: `useSideEffects.ts`의 `getHostSideEffects()` — `InteractiveSession`을 `ISideEffects`로 이중 캐스팅

**위치**: `packages/agent-cli/src/ui/hooks/useSideEffects.ts:239-241`

**현상**:

```typescript
function getHostSideEffects(interactiveSession: InteractiveSession): ISideEffects {
  return interactiveSession as unknown as ISideEffects;
}
```

`InteractiveSession` 인스턴스를 `ISideEffects` 인터페이스(내부 플래그 객체)로 이중 캐스팅한다. `ISideEffects`는 `_pendingModelId`, `_resetRequested` 등의 언더스코어 플래그들을 정의하는데, `InteractiveSession`이 이 필드들을 실제로 갖고 있는지 타입 시스템이 보장하지 못한다.

이 패턴은 테스트 불가하고, `InteractiveSession` 구현 변경 시 조용히 깨질 수 있다.

**영향**: 사이드 이펙트 플래그(`_pendingModelId` 등)가 실제로 `InteractiveSession`에 없는 경우 `undefined` 반환 → 명령 효과 미적용.

**수정 방안**: `ISideEffects` 플래그를 `InteractiveSession`이 아닌 별도의 상태 객체로 관리. 또는 `InteractiveSession`에 공식 sideEffects 채널(이벤트 또는 속성)을 추가.

---

### QA-M-003: `--no-session-persistence` 플래그가 인터랙티브 TUI 모드에서 무시됨

**위치**: `packages/agent-cli/src/cli.ts:361, 399`

**현상**:

```typescript
// 헤드리스(-p) 모드: 올바르게 처리됨
sessionStore: args.noSessionPersistence ? undefined : sessionStore,

// 인터랙티브 TUI 모드: noSessionPersistence 무시, 항상 sessionStore 전달
renderApp({
  ...
  sessionStore,   // noSessionPersistence 체크 없음
  ...
});
```

`--no-session-persistence` 플래그는 print mode(`-p`)에서는 올바르게 처리되지만, 인터랙티브 모드에서는 세션이 항상 저장된다.

**기대 동작**: `--no-session-persistence` 시 TUI 모드에서도 세션 저장 불가.

**수정 방안**:

```typescript
renderApp({
  ...
  sessionStore: args.noSessionPersistence ? undefined : sessionStore,
  ...
});
```

---

### QA-M-004: `agent-server`의 `app.ts`에서 `GoogleProvider` 환경변수 키 불일치

**위치**: `apps/agent-server/src/app.ts:82-85`

**현상**:

```typescript
if (process.env.GOOGLE_API_KEY) {
  providers.google = new GoogleProvider({
    apiKey: process.env.GOOGLE_API_KEY,
  });
}
```

이전 QA-001 리포트에서 확인된 실제 키는 `GEMINI_API_KEY`로 저장되어 있었으나, 코드에서는 `GOOGLE_API_KEY`를 읽는다. `.env.example` 또는 배포 환경에서 `GEMINI_API_KEY`를 사용하면 Google 프로바이더가 조용히 비활성화된다.

**재현 방법**: `.env`에 `GEMINI_API_KEY=...` 설정 후 서버 시작 → `/api/v1/remote/health`에서 `providers: []` (google 미포함).

**기대 동작**: 환경변수 이름을 문서화하고 일관되게 사용 또는 `GEMINI_API_KEY`도 폴백으로 지원.

---

## Low Issues (낮은 우선순위)

### QA-L-001: `SessionStatusBar`에서 `resolveGitBranch()` 호출이 모든 렌더링마다 실행될 수 있음

**위치**: `packages/agent-cli/src/ui/SessionStatusBar.tsx:39`

**현상**:

```typescript
const gitBranch = useMemo(() => resolveGitBranch(cwd), [cwd]);
```

`useMemo`는 `cwd` 변경 시에만 재계산하므로 올바른 패턴이다. 그러나 `resolveGitBranch()`는 동기적으로 `execSync`를 호출하여 `git branch` 명령을 실행한다. 대규모 git 저장소이거나 느린 파일시스템에서는 매 cwd 변경 시 UI가 일시 차단될 수 있다.

**영향**: 저장소 크기나 파일시스템 성능에 따라 상태바 렌더링 지연.

**수정 방안**: `resolveGitBranch()`를 비동기(`exec` 대신 `execAsync`) + 별도 `useEffect`로 이동, 결과를 `useState`에 저장.

---

### QA-L-002: `agent-web/src/lib/cache.ts`의 cleanup `setInterval`이 SSR 환경 체크 없이 등록됨

**위치**: `apps/agent-web/src/lib/cache.ts:108-116`

**현상**:

```typescript
if (typeof window !== 'undefined') {
  setInterval(
    () => {
      cache.cleanup();
      userCache.cleanup();
      apiCache.cleanup();
    },
    10 * 60 * 1000,
  );
}
```

`window` 체크는 있으나 `setInterval` 반환값이 저장되지 않아 cleanup 함수 없이 영구 실행된다. Next.js 앱 라우터 환경에서 모듈이 여러 번 hot-reload되면 인터벌이 누적된다.

**영향**: 개발 환경에서 hot-reload 시 메모리 누수 가능.

**수정 방안**: 모듈 레벨에서 인터벌 핸들을 저장하거나, 앱 라이프사이클에서 정리하도록 변경.

---

## 이전 이슈 업데이트 (v1 → v2)

| 이슈                            | 상태                          | 내용                                                                                                                                                                                              |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-002 (JWT 인증 미구현)        | **부분 수정**                 | `jsonwebtoken`으로 서명 검증 추가됨. 단, `JWT_SECRET` 미설정 시 3-파트 형식만 확인하는 개발 폴백 여전히 존재 (websocket-server.ts:185-191). 프로덕션 배포 전 `JWT_SECRET` 환경변수 필수 설정 필요 |
| QA-003 (graceful shutdown)      | **수정됨**                    | `server.close()` → `wsServer.close()` → 30초 강제 종료 타임아웃 패턴 구현됨 (server.ts:50-62)                                                                                                     |
| QA-004 (setInterval 누수)       | **수정됨**                    | `this.cleanupInterval` 필드에 저장, `close()`에서 `clearInterval` 호출 (websocket-server.ts:50, 347)                                                                                              |
| QA-005 (비-TTY 크래시)          | **수정됨**                    | `stdin.isTTY` 가드 추가됨 (cli.ts:105-115)                                                                                                                                                        |
| QA-006 (미구현 엔드포인트 광고) | **수정됨**                    | 루트 응답에서 `stream`, `capabilities` 엔드포인트 제거됨 (app.ts:126-130)                                                                                                                         |
| QA-011 (require.main ESM)       | **수정됨** — 단, 새 이슈 확인 | `require.main === module` 조건 여전히 사용 (server.ts:72). tsup이 CJS로 컴파일하므로 런타임 동작하지만, v1 리포트 그대로 ESM 전환 시 깨짐                                                         |
| QA-013 (deprecated substr)      | **미수정**                    | websocket-server.ts:297에 `substr(2, 9)` 여전히 존재                                                                                                                                              |

---

## 미점검 영역 (이번 v2 점검에서도 제외)

| 영역                                        | 이유                                        |
| ------------------------------------------- | ------------------------------------------- |
| `packages/agent-sdk` 내부 세션 라이프사이클 | 범위 외 — 별도 SPEC.md 및 592개 테스트 존재 |
| 실제 AI 프로바이더 응답 처리                | 실제 네트워크 및 API 키 필요                |
| Firebase Functions 배포 설정                | Firebase 환경 미구축                        |
| GitHub Actions CI 파이프라인                | 워크플로우 파일 미확인                      |
| 접근성 (a11y)                               | TUI CLI 환경 특성상 해당 없음               |
