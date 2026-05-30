# Robota CLI — 시니어 개발자 기술 검토 보고서

**검토 일자:** 2026-05-23  
**검토 대상 버전:** 3.0.0-beta.67  
**검토자:** Senior TypeScript Engineer (automated)

---

## 요약 (전체 완성도 점수: 8.0/10)

Robota CLI는 전반적으로 높은 수준의 기술 완성도를 보인다. 레이어 분리, DI 패턴, 스트리밍 아키텍처, 에러 처리, 보안 기본기(민감 키 redaction, env-ref 인다이렉션) 모두 숙련된 설계 의도가 보인다. 특히 `agent-framework`의 테스트 커버리지(82개 파일)와 `agent-provider`의 공유 OpenAI-compatible 레이어 추상화는 주목할 만하다. 반면 **Anthropic provider의 vision(이미지 입력) 미지원**, **세션 복원 시 non-string content를 가진 tool 메시지 묵시적 스킵**, **InteractiveSession shutdown 시 listeners Map 미정리**, **help 텍스트와 `--dry-run` 파서 타입 불일치** 등 몇 가지 명확한 결함이 존재한다. 전체적으로 production 배포 전 수정이 필요한 항목은 4~5개 정도다.

---

## 항목별 상세 평가

### 1. 아키텍처 건전성

**현황:** 5개 레이어로 명확히 분리되어 있다.

- `agent-core`: 의존성 없음 (외부 의존: `jssha`, `zod`만)
- `agent-session` → `agent-core`
- `agent-provider` → `agent-core`
- `agent-framework` → `agent-core`, `agent-session`, `agent-tools`, `agent-executor`
- `agent-cli` → 위 전체 조합

`agent-core`는 다른 `agent-*` 패키지를 임포트하지 않는다 (규칙 준수 확인됨). `InteractiveSession`이 `InteractiveSessionBase`, execution-controller, background-tracker, history-tracker, skill-router로 분해되어 있어 복잡도가 분산된다.

**발견된 문제:**

- `agent-framework/src/interactive/interactive-session.ts` (409줄)가 다수의 private 메서드를 포함해 규칙 300줄 한도를 약간 초과한다.
- `agent-framework/src/index.ts` (666줄)은 단순 재수출 집합이므로 라인 수 자체가 문제는 아니나, 수출 가짓수가 많아 공개 API 경계가 넓다.
- `IProviderConfig`에 `[key: string]: string | number | boolean | undefined` 인덱스 시그니처가 있어, 이를 확장하는 구현체에서 타입 안전성 홀이 생긴다.

**위치:** `packages/agent-core/src/abstracts/abstract-ai-provider.ts` L50–51, `packages/agent-framework/src/interactive/interactive-session.ts`

---

### 2. TypeScript 완성도

**현황:** 탁월하다. 6개 핵심 패키지 소스 파일 전체에서 `as any`, `: any`, `@ts-ignore`, `@ts-nocheck` 가 **단 한 건도 없다**. Zod로 설정 파일을 파싱하고, 판별 유니온(discriminated union) 패턴이 곳곳에 적용되어 있다.

**발견된 문제:**

- `ISessionRecord` (`packages/agent-session/src/session-store.ts` L27–50)의 `messages`, `history`, `backgroundTasks` 등 9개 필드가 `unknown[]`로 선언되어 있다. 의도적인 허용이지만(역직렬화 전 raw 데이터), 이후 코드에서 타입 단언 없이 사용될 경우 런타임 오류 가능성이 있다.
- `session-run.ts` L77에 `const provider = ctx.aiProvider as { onTextDelta?: unknown }` 강제 캐스팅이 있다. 주석에 "This workaround stays until..."이라고 명시되어 있으므로 기술 부채로 관리 필요.
- `abstract-ai-provider.ts`의 `IExecutorAwareProviderConfig` 인덱스 시그니처가 `IExecutor`를 포함하는데, 이 타입은 `string | number | boolean | IExecutor | undefined`로 union이 넓어 실용성이 낮다.

---

### 3. 테스트 커버리지

| 패키지          | 테스트 파일 수 | 비고               |
| --------------- | -------------- | ------------------ |
| agent-core      | 46             | 충분               |
| agent-framework | 82             | 우수               |
| agent-provider  | 41             | 충분 (spec + test) |
| agent-command   | 21             | 충분               |
| agent-session   | 9              | 낮음               |
| agent-cli       | 5              | 낮음               |

**발견된 문제:**

- **agent-cli**: 5개 파일로 tui-mode, print-mode, bin.ts, config-phase, shell-exec 등 주요 실행 경로에 대한 e2e/통합 테스트가 없다. 특히 `runTuiMode`, `runPrintMode`는 테스트 커버리지가 0이다.
- **agent-session**: 세션 복원(`session-log-replay.ts`)에 대한 테스트는 존재하지만 `PermissionEnforcer` 전체 흐름, `CompactionOrchestrator`, `context-window-tracker`에 대한 통합 테스트가 부족하다.
- `session-logger.ts`의 JSONL 로깅 경로는 `appendFileSync` 실패 시 `catch {}` (무시)로 처리되는데, 이는 의도적이지만 로그 유실 감지가 불가능하다.

---

### 4. 에러 핸들링

**현황:** 전반적으로 견고하다. abort signal 처리가 `streamWithAbort` 유틸로 표준화되어 있고, `AbortError` 구분 처리, `DOMException('Aborted', 'AbortError')` 재throw 패턴이 일관적이다.

**발견된 문제:**

- **`session-store.ts` L120:** `JSON.parse(raw) as ISessionRecord`에 try/catch가 없다. `list()` 메서드(L135)에는 `catch {}` 처리가 있지만, `load()` 메서드는 corrupt JSON 시 예외가 caller로 전파된다.

  ```ts
  // 현재 (취약)
  load(id: string): ISessionRecord | undefined {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as ISessionRecord; // 예외 전파
  }
  ```

- **`session-run.ts` L171:** `StopFailure` hook은 `fire-and-forget` (.catch(() => {}))로 호출된다. hook 실패 정보가 완전히 무시된다.
- **`compaction-orchestrator.ts` L95:** `provider.chat()` 실패 시 `summary`가 `'(compaction failed)'` 문자열로 대체되는데, 이것이 대화 히스토리에 삽입될 경우 AI가 혼란스러워할 수 있다. 예외를 caller에게 전파하는 것이 더 안전하다.
- `settings-io.ts` L34: corrupt JSON이면 `{}` 반환하는 silent fallback이 있다. 이는 사용자 설정을 조용히 무시하게 만들 수 있다 (현재 `stderr` 경고를 출력하긴 함).

---

### 5. CLI 명령어 완성도

**현황:** 슬래시 커맨드 구현이 매우 풍부하다.

구현된 슬래시 커맨드:
`/agent`, `/background`, `/compact`, `/context`, `/exit`, `/help`, `/language`, `/memory`, `/mode`, `/model`, `/permissions`, `/plugin`, `/provider`, `/reset`, `/rewind`, `/session`, `/settings`, `/skills`, `/statusline`, `/user-local`

**발견된 문제:**

- **help 텍스트 불일치:** `cli-args.ts` L75에 `--dry-run <prompt>` 라고 되어 있지만 파서에서는 `boolean` 타입으로 선언된다 (L158). `--dry-run`은 플래그일 뿐이고 prompt는 positional 인자로 전달된다. help 텍스트가 사용자를 혼란시킬 수 있다.

  ```
  # help에는: --dry-run <prompt>
  # 실제 동작: robota --dry-run "some prompt"  ← "some prompt"는 positional로 처리됨
  ```

  **위치:** `packages/agent-cli/src/utils/cli-args.ts` L75, L158

- `/settings` 커맨드는 `settings-command-module.ts`가 있지만 구현 파일에 실제 로직이 없다 (`createSettingsCommandModule` 만 export). 완성되지 않았을 수 있다.
- `/rewind` 커맨드는 edit checkpoint 기능과 연결되지만, TUI에서 명시적으로 안내되지 않아 discoverability가 낮다.

---

### 6. 프로바이더 지원 완성도

| 프로바이더               | Streaming        | Tool Use    | Vision (입력)    | 이미지 생성 | 웹 검색            |
| ------------------------ | ---------------- | ----------- | ---------------- | ----------- | ------------------ |
| Anthropic                | ✅               | ✅          | ❌               | ❌          | ✅ (server tool)   |
| OpenAI (Responses)       | ✅               | ✅          | ✅ (URI/inline)  | ❌          | ❌                 |
| OpenAI (ChatCompletions) | ✅               | ✅          | ❌               | ❌          | ❌                 |
| Gemini                   | ✅               | ✅          | ✅ (inline only) | ✅          | ❌                 |
| DeepSeek                 | ✅               | ✅          | ❌               | ❌          | ❌                 |
| Qwen                     | ✅               | ✅          | ❌               | ❌          | ✅ (Responses API) |
| Gemma                    | ✅               | ✅ (pseudo) | ❌               | ❌          | ❌                 |
| Bytedance                | ❌ (비디오 전용) | ❌          | ❌               | ❌ (video)  | ❌                 |

**발견된 문제:**

- **Anthropic vision 미지원 (Critical):** `convertToAnthropicFormat` (`packages/agent-provider/src/anthropic/message-converter.ts` L18–81)은 user 메시지를 `content: msg.content || ''` 단일 문자열로만 변환한다. `TUniversalMessage`의 `parts` 배열(이미지 포함)을 무시한다. provider-definition에는 `'vision'` 이 capabilities로 명시되어 있으나 실제 구현이 없다.

  **위치:** `packages/agent-provider/src/anthropic/message-converter.ts` L20–23, `packages/agent-provider/src/anthropic/provider-definition.ts` L81

- **OpenAI ChatCompletions vision 미지원:** `shared/openai-compatible/message-converter.ts`의 `convertMessage`가 user 메시지를 문자열만 처리한다. Responses API path는 이미지를 처리하지만 ChatCompletions 경로는 미지원이다.

- **DeepSeek/Qwen(ChatCompletions)/Gemma의 vision:** 동일하게 shared converter를 쓰므로 동일 문제 존재.

- **OpenAI의 `nativeWebTools`가 완전 비활성화:** 현재 코드에서 OpenAI Responses API의 web_search, web_fetch는 `supported: false`로 하드코딩되어 있다 (`packages/agent-provider/src/openai/provider.ts` L164–181). 향후 지원 예정이라도 provider-definition의 capabilities와 불일치 가능성이 있다.

---

### 7. 세션/체크포인트 견고성

**현황:** append-only JSONL 트랜스크립트, 세션 JSON 파일, 체크포인트 스토어가 병렬로 동작하며 재개/포크/복구 로직이 체계적이다. 비정상 종료된 background task를 `stale_worker`로 reconcile하는 로직이 있다.

**발견된 문제:**

- **tool 메시지의 non-string content 묵시적 스킵:** `interactive-session-restore.ts` L24의 `injectSavedMessage`가 `typeof msg.content !== 'string'` 이면 조용히 무시한다. 복잡한 tool 결과(parts 배열 등)가 있을 경우 세션 복원 시 히스토리가 불완전해지고, 다음 AI 호출에서 tool_use 후 tool_result 누락으로 400 에러가 발생할 수 있다.

  **위치:** `packages/agent-framework/src/interactive/interactive-session-restore.ts` L24

- **세션 파일 쓰기가 동기 I/O:** `SessionStore.save()`가 `writeFileSync`를 사용한다. 이는 이벤트 루프를 블록하며, 대화 빈도가 높을 경우 성능 병목이 될 수 있다. 세션 파일이 10~100KB 규모로 성장하면 문제가 커진다.

  **위치:** `packages/agent-session/src/session-store.ts` L107

- **세션 JSON에 tool schema 포함:** `ISessionRecord.toolSchemas`가 저장되어 있어 세션 파일 크기가 불필요하게 커질 수 있다. 이는 재시작 시 재생성 가능한 정보다.

---

### 8. 빌드/배포 준비도

**현황:** tsdown 기반의 duallformat(ESM+CJS) 빌드, bin은 CJS shim 래퍼로 Node 버전 검사, npm publish 안전게이트(`check-pnpm-publish.sh`)가 있다. `package.json`의 `engines: { node: ">=22.0.0" }`도 명시되어 있다.

**발견된 문제:**

- **`agent-cli/tsdown.config.ts`와 `agent-cli/tsup.config.ts`가 공존한다.** tsdown이 새로운 빌드 도구이지만, 구 tsup 설정 파일이 남아있다. tsup config는 더 많은 entry(`subagents/child-process-subagent-worker`)를 포함한다. 빌드 스크립트는 `tsdown`만 호출하므로 tsup config는 dead code이지만, 혼란을 일으킬 수 있다.

  **위치:** `packages/agent-cli/tsup.config.ts` (불필요한 파일)

- **`agent-cli/package.json`의 `files: ["dist", "bin"]`**: `bin/robota.cjs`가 정상적으로 포함되어 있다. 그러나 `node_modules` 내 workspace dependency들의 빌드 유무에 따라 publish 시 실제 동작이 달라질 수 있다.

- **`bin/robota.cjs`가 git에 커밋되어 있다**: 빌드 artifact가 레포에 체크인되어 있어 변경 추적이 어렵다.

---

### 9. 성능 고려사항

**현황:** streaming 응답이 모든 provider에서 구현되어 있고, AbortSignal을 통한 취소 경로가 있다. `streamWithAbort` 헬퍼가 `yieldToMacrotask` (setTimeout 0)를 통해 이벤트 루프를 양보한다.

**발견된 문제:**

- **`InteractiveSession.shutdown()` 시 listeners Map 미정리:** `shutdown()`에서 `this.listeners`를 clear하지 않는다. 긴 세션에서 많은 핸들러가 등록된 경우 GC 대상이 되지 않을 수 있다.

  **위치:** `packages/agent-framework/src/interactive/interactive-session.ts` L288–302

- **`SessionStore.list()`가 전체 디렉토리를 동기 읽기:** `readdirSync` + 각 파일 `readFileSync`를 반복하는 O(n) 동기 I/O다. 세션이 수백 개로 늘어날 경우 TUI 시작 시 주목할만한 지연이 발생할 수 있다.

  **위치:** `packages/agent-session/src/session-store.ts` L127–147

- **`session-run.ts` L194–206:** 매 응답 후 `JSON.stringify(postHistory)`로 히스토리 전체를 직렬화하여 문자열 길이를 계산한다. 히스토리가 길어질수록 매 턴마다 이 비용이 선형 증가한다.

- **Compaction 시 `onTextDelta` 인스턴스 속성 임시 제거:** `session-run.ts` L77–84의 provider.onTextDelta 임시 교체 패턴은 thread-safe하지 않다. async context에서 경쟁 조건 가능성이 있다 (주석에도 workaround로 명시됨).

---

### 10. 보안

**현황:** 여러 보안 기본기가 잘 구현되어 있다.

- `SENSITIVE_KEY_PATTERN` 정규식으로 api_key, authorization, access_token 등을 JSONL 로그에서 자동 redact
- API key는 `$ENV:VAR_NAME` 형식으로 환경변수 인다이렉션 저장 권장 (`formatEnvReference`)
- `--api-key` CLI 플래그가 제공되면 settings.json에 plain text로 저장되는 경로 존재
- 권한 게이트(plan/default/acceptEdits/bypassPermissions), hook 기반 PreToolUse/PostToolUse가 있음
- JSON 파싱 결과에 `as T` 타입 단언이 광범위하게 사용되며 실제 스키마 검증이 없음 (settings는 Zod로 검증하지만 세션 파일은 미검증)

**발견된 문제:**

- **`--api-key` 플래그 plain text 저장 경로:** `robota --configure-provider anthropic --type anthropic --api-key sk-... --set-current` 명령어를 실행하면 API key가 `settings.json`에 plain text로 저장된다. 경고 메시지 없음.

  **위치:** `packages/agent-framework/src/command-api/provider/provider-settings.ts` L158–164

- **세션 로그 `SENSITIVE_KEY_PATTERN`이 nested object 내 민감 키를 redact하지 않을 수 있다:** `normalizeLogValue` 는 object key를 체크하지만, 값이 중첩 object인 경우 내부 키의 redaction 여부는 재귀 처리에 의존한다. 이 경로에 대한 테스트가 불분명하다.

- **`session-store.ts` `load()` 의 `JSON.parse` 결과를 `as ISessionRecord`로 직접 캐스팅**: corrupt 또는 악의적으로 조작된 세션 파일이 있을 경우 런타임 오류를 일으킬 수 있다 (실용적 위협 수준은 낮음).

---

## 즉시 수정 필요 (Critical)

### C-1. `SessionStore.load()` — JSON 파싱 예외 처리 누락

**위치:** `packages/agent-session/src/session-store.ts` L119  
`list()`에는 `catch {}` 처리가 있지만 `load()`에는 없다. corrupt 세션 파일이 존재하면 `--continue`나 `--resume` 실행 시 uncaught exception이 발생한다.

```ts
// 수정 방향
load(id: string): ISessionRecord | undefined {
  const path = this.filePath(id);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ISessionRecord;
  } catch {
    return undefined; // corrupt file treated as missing
  }
}
```

### C-2. Anthropic provider `vision` capability 선언과 미구현 불일치

**위치:** `packages/agent-provider/src/anthropic/provider-definition.ts` L81, `packages/agent-provider/src/anthropic/message-converter.ts` L18–23  
`provider-definition.ts`에는 `'vision'`이 capabilities로 명시되어 있으나 `convertToAnthropicFormat`이 user 메시지의 `parts` 배열을 무시한다. 이미지가 있는 user 메시지가 전달되면 이미지가 조용히 무시된다.  
**단기 수정:** provider-definition에서 `'vision'` 제거 또는 message-converter에서 `parts` 처리 추가.

### C-3. 세션 복원 시 non-string content tool 메시지 묵시적 스킵

**위치:** `packages/agent-framework/src/interactive/interactive-session-restore.ts` L24  
`if (typeof msg.content !== 'string') return;`으로 tool 메시지가 조용히 스킵된다. 복원된 대화에서 `tool_use` 이후 `tool_result`가 없을 경우 Anthropic API가 400을 반환한다.  
**수정 방향:** content가 string이 아닌 경우 JSON.stringify 처리 또는 명시적 경고를 emit해야 한다.

---

## 단기 개선 권고 (High)

### H-1. help 텍스트의 `--dry-run <prompt>` 오해를 유발하는 표현 수정

**위치:** `packages/agent-cli/src/utils/cli-args.ts` L75  
`--dry-run <prompt>`를 `--dry-run` (플래그, prompt는 positional 인자로 전달)으로 수정하고, 사용 예시를 명확히 해야 한다.

### H-2. `InteractiveSession.shutdown()` 시 listeners 정리

**위치:** `packages/agent-framework/src/interactive/interactive-session.ts` L288–302  
shutdown 완료 후 `this.listeners.clear()`를 호출해 GC 가능하게 만들어야 한다.

### H-3. `--api-key` 플래그로 plain text 저장 시 경고 출력

**위치:** `packages/agent-cli/src/startup/provider-startup.ts` L34  
API key가 plain text로 저장될 경우 `--api-key-env`를 사용하라는 경고를 출력해야 한다.

### H-4. `agent-cli`의 tui-mode / print-mode 통합 테스트 추가

현재 5개의 테스트 파일이 모두 unit 테스트이며 실제 실행 흐름에 대한 테스트가 없다. Headless transport를 사용하는 smoke test라도 추가가 필요하다.

### H-5. `tsup.config.ts` 정리

**위치:** `packages/agent-cli/tsup.config.ts`  
tsdown으로 마이그레이션 후 남은 dead artifact다. 혼란 방지를 위해 삭제가 권고된다.

---

## 장기 개선 권고 (Medium/Low)

### M-1. `SessionStore` 비동기 I/O 전환

현재 `save()`, `load()`, `list()`가 모두 동기 fs API를 사용한다. 세션 파일이 수십 KB 규모로 커지면 이벤트 루프 블록이 가시화될 수 있다. `writeFile`, `readFile`, `readdir` 비동기 버전으로 전환을 권고한다.

### M-2. `compaction-orchestrator.ts`의 `(compaction failed)` silent fallback 제거

**위치:** `packages/agent-session/src/compaction-orchestrator.ts` L92  
compaction 실패 시 오류를 은닉하는 대신 예외를 전파하거나 UI에서 명시적 오류로 처리해야 한다.

### M-3. OpenAI ChatCompletions 경로에서 vision(multipart user message) 지원

**위치:** `packages/agent-provider/src/shared/openai-compatible/message-converter.ts` L33–36  
GPT-4o 등 비전 모델을 ChatCompletions 경로로 사용할 경우 이미지 파트를 `content_block` 배열로 변환해야 한다.

### M-4. `session-run.ts`의 compaction 시 `onTextDelta` 임시 교체 패턴 해결

**위치:** `packages/agent-session/src/session-run.ts` L77–84  
코드 주석에도 명시된 architectural workaround다. provider가 `IChatOptions.onTextDelta`를 instance property보다 우선시하도록 설계를 변경하면 이 패턴이 불필요해진다.

### M-5. `ISessionRecord` 필드의 `unknown[]` 타입 구체화

**위치:** `packages/agent-session/src/session-store.ts` L27–50  
`messages`, `history` 등의 타입을 `TUniversalMessage[]`, `IHistoryEntry[]`로 구체화하면 저장/로드 지점에서 타입 안전성이 향상된다.

### L-1. `agent-session` 테스트 커버리지 확장

`PermissionEnforcer`, `CompactionOrchestrator`, `context-window-tracker`에 대한 단위 테스트 추가를 권고한다.

### L-2. `bin/robota.cjs` git 추적 제거

빌드 artifact는 `.gitignore`에 추가하고 publish 시 빌드 단계에서 생성하도록 CI를 구성하는 것을 권고한다.
