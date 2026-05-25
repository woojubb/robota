# Robota CLI — PM 완성도 및 사용성 보고서

생성일: 2026-05-24  
대상 버전: `@robota-sdk/agent-cli` v3.0.0-beta.67  
분석 범위: `packages/agent-cli` 전체, `packages/agent-command/src/session/`, `.agents/backlog/`

---

## 요약 (TL;DR)

Robota CLI는 기술 아키텍처 면에서 경쟁력 있는 AI 코딩 어시스턴트다. 멀티 프로바이더 지원, MIT 오픈소스, SDK 임베딩 가능성이라는 세 가지 진짜 차별점을 보유하고 있다. 그러나 **실제 사용자가 그 가치에 도달하기 전에 막히는 마찰들**이 존재한다.

- **출시 준비도**: 70/100 — 개인 개발자 탐색용은 가능하나 Product Hunt 런칭은 P0 이슈 해결 후 권고
- **가장 강한 강점**: 멀티 프로바이더 one-config 전환, SDK 임베딩 플랫폼 포텐셜
- **가장 큰 약점**: Node 22 진입 장벽, `--diagnose` 미구현(백로그에 있으나 미완), 빈 프로젝트 온보딩 가이던스 부재
- **핵심 제언**: 현재 "Claude Code 대안 CLI" 포지셔닝을 "AI 코딩 도구를 만드는 엔진(SDK 플랫폼)"으로 전환하는 것이 PMF 달성 가능성이 더 높다

---

## 1. 첫 실행 경험 (FTUE) 평가

### 실제 첫 실행 흐름 분석

`first-run.ts`를 직접 읽은 결과, 첫 실행 탐지는 `~/.robota/onboarded` 파일 유무로 판단한다. 이 파일이 없으면 웰컴 메시지를 `process.stderr`에 출력한다.

**실제 웰컴 메시지 (코드 기준):**

```
╭─────────────────────────────────────────────────────────────╮
│  Welcome to robota!  — AI coding assistant                  │
│                                                             │
│  Try asking:                                                │
│    "Explain this project structure"                         │
│    "Find files with TODO comments"                          │
│    "Run tests and analyze failures"                         │
│    "What changed recently in git?"                          │
│                                                             │
│  Useful commands:                                           │
│    /help      show all slash commands                       │
│    /cost      show token usage and estimated cost           │
│    /clear     clear conversation history                    │
│                                                             │
│  robota diagnose   — check your setup                       │
╰─────────────────────────────────────────────────────────────╯
```

### 평가

**좋은 점:**

- 웰컴 메시지 디자인이 깔끔하다. 4개 예시 프롬프트가 즉시 시도 가능한 수준으로 구체적이다.
- "robota diagnose" 안내가 포함되어 있어 첫 실행 실패 시 자가 진단 경로가 있다.
- 박스 UI(╭─╮)가 터미널에서 시각적 인상을 준다.

**문제점:**

- 웰컴 메시지가 **프로바이더 설정 전**에 나오는 구조다. API 키 미설정 사용자는 웰컴 메시지를 본 직후 프로바이더 설정 인터랙션을 만난다. 흐름이 끊긴다.
- 영어 전용이다. `/language ko`로 한국어 전환이 가능하지만, 첫 실행 메시지 자체는 설정된 언어를 반영하지 않는다.
- `robota diagnose`라고 안내하는데 실제 플래그 문법은 `robota diagnose` (positional argument)다. README에는 `--diagnose`로 표기한 곳도 있어 혼용이 있다.

### API 키 없이 실행 시 경험

`provider-startup.ts`의 `formatMissingProviderConfigMessage` 함수가 출력하는 오류 메시지:

```
No provider configuration found.
Run `robota --configure` in an interactive terminal, or configure a provider:
Supported providers: anthropic | openai | deepseek | gemma | qwen
  robota --configure-provider anthropic --type anthropic --api-key-env <ENV_NAME> --set-current
  robota --configure-provider openai --type openai --api-key-env <ENV_NAME> --set-current
  robota --configure-provider deepseek --type deepseek --api-key-env <ENV_NAME> --set-current
  ...
```

이 메시지는 기술적으로 정확하지만 **비개발자 친화적이지 않다**. "어떤 API 키가 무료인가?", "API 키 없이 쓸 수 있는가?"라는 질문에 답하지 않는다. `https://console.anthropic.com` 링크가 `diagnose-command.ts`에만 있고 이 오류 메시지에는 없다.

**FTUE 점수: 6.5/10**

---

## 2. 온보딩 완성도

### `robota init` 분석 (`init-command.ts`)

`robota init` 실행 시:

1. AGENTS.md가 없으면 템플릿 생성 (`## Project Overview`, `## Common Commands` 포함)
2. `.robota/settings.json` 기본 생성
3. `.claude/` 디렉토리 감지 시 Claude Code 설정 마이그레이션 옵션 제공 (`Migrate Claude Code settings to .robota/?`)
4. "Next steps" 안내 출력

**실제 출력 (코드 기준):**

```
Created: .robota/settings.json
Created: AGENTS.md

Initialization complete.

Next steps:
  1. Edit AGENTS.md to describe your project conventions
  2. Run `robota --configure` to set up your AI provider
  3. Run `robota` to start the assistant
```

**좋은 점:**

- Claude Code 설정 자동 감지 + 마이그레이션 제안이 훌륭하다. 경쟁 제품 사용자를 자연스럽게 흡수하는 경로다.
- Next steps가 순서대로 명확하다.
- AGENTS.md 템플릿이 `<!-- Describe your project... -->`처럼 직접 편집 가이드를 포함한다.

**문제점:**

- 프로바이더 설정이 빠져있다. `robota init` 완료 후 곧바로 `robota`를 실행하면 "No provider configuration found" 오류가 난다. `robota init` 안에서 프로바이더 설정을 인라인으로 진행하거나, 최소한 API 키 설정 방법을 명확히 안내해야 한다.
- AGENTS.md 템플릿이 JavaScript/npm 가정이다 (`npm install`, `npm test`). Python, Go, Rust 사용자에게는 바로 수정이 필요하다.

### `robota diagnose` 분석 (`diagnose-command.ts`)

**체크 항목 6가지:**

1. Node.js 버전 (>=22 체크)
2. robota 버전 표시
3. API 키 존재 여부 (ANTHROPIC, OPENAI, GEMINI, DEEPSEEK 환경 변수)
4. 설정 파일 존재 여부
5. 터미널 감지 (macOS Terminal.app 경고)
6. 네트워크 연결 (`api.anthropic.com:443` TCP 연결, 3초 타임아웃)

**실제 출력 예시 (코드 기준):**

```
robota --diagnose

  ✓ Node.js version: v22.14.0
  ✓ robota version: 3.0.0-beta.67
  ✗ API key: No API key found
    Set ANTHROPIC_API_KEY or run: robota configure
    Get key: https://console.anthropic.com/settings/keys
  ⚠ Settings file: Not found — run: robota configure
  ⚠ Terminal: macOS Terminal.app — CJK/IME input may be unstable
    Recommendation: use iTerm2 (https://iterm2.com)
  ✓ Network (api.anthropic.com): reachable (127ms)

✗ 1 issue(s) found. Fix the items above to use robota.
```

**강점:**

- `✓/⚠/✗` 아이콘으로 한눈에 상태 파악 가능
- 각 실패 항목에 해결 방법 + 링크가 포함되어 있다
- 네트워크 연결 테스트가 포함되어 있어 방화벽/프록시 환경 진단에 유용하다

**약점:**

- `DASHSCOPE_API_KEY`(Qwen)이 체크 항목에 없다. 5개 프로바이더 중 4개만 체크한다.
- 네트워크 체크가 `api.anthropic.com`만 체크한다. OpenAI, DeepSeek 등 다른 프로바이더 사용자에게는 부정확한 결과를 줄 수 있다. 현재 설정된 프로바이더 엔드포인트를 체크해야 한다.
- `robota configure`라고 안내하는데 실제 플래그는 `robota --configure`다. 일관성 문제.

### `robota --configure` (인터랙티브 설정 흐름)

`provider-startup.ts`가 `runProviderStartupSetup`을 통해 프로바이더 선택 → API 키 입력 → 언어 선택 흐름을 진행한다. 이 흐름은 `promptInput` 기반으로 순차 진행되며 `~/.robota/settings.json`을 생성한다.

**주목할 점:**

- headless/비인터랙티브 환경에서는 프롬프트를 띄우지 않는 가드가 있다 (`isInteractive: () => isInteractive`).
- `CLI-001`(비-TTY 환경 크래시 방지) 백로그가 `high` 우선순위로 존재한다는 것은, 이 가드가 아직 불완전할 수 있다는 의미다.

**온보딩 완성도 점수: 6/10**

---

## 3. 경쟁사 대비 포지셔닝

### 경쟁 매트릭스

| 항목                  | Robota                | Claude Code    | Aider          | Cline (VSCode) |
| --------------------- | --------------------- | -------------- | -------------- | -------------- |
| 프로바이더            | 멀티 (5+)             | Anthropic 독점 | 멀티           | 멀티           |
| 가격                  | BYOK                  | $20/월 + 토큰  | BYOK           | BYOK           |
| 설치 방식             | CLI (npx)             | CLI (npm)      | pip            | VSCode 확장    |
| 로컬 모델 지원        | ✅ (LM Studio, Gemma) | ❌             | ✅ (Ollama)    | ✅             |
| SDK 임베딩            | ✅                    | ❌             | ❌             | ❌             |
| 오픈소스              | MIT                   | 부분 공개      | Apache 2.0     | MIT            |
| git 통합              | 약 (없음)             | 강             | 강 (핵심 기능) | 보통           |
| 커뮤니티              | 초기                  | 대형           | 성숙           | 성숙           |
| Node 버전 요구        | 22+                   | 없음           | Python 3.9+    | N/A            |
| Claude Code 설정 호환 | ✅ (.claude/ 읽기)    | 해당 없음      | ❌             | ❌             |

### Claude Code 대비 Robota의 진짜 강점

**1. 멀티 프로바이더 one-config:**
`settings.json`에서 `currentProvider: "deepseek"` 한 줄로 DeepSeek로 전환 가능. Claude Code는 Anthropic 모델만 사용.

**2. Claude Code 설정 호환:**
`init-command.ts`에서 `.claude/settings.json` 자동 감지 및 마이그레이션을 제공한다. Claude Code 사용자가 robota로 옮길 때 설정을 다시 작성할 필요가 없다.

**3. SDK 임베딩 (가장 큰 차별점):**
`@robota-sdk/agent-framework` import로 AI 코딩 어시스턴트 세션을 자체 앱에 내장 가능. Claude Code, Aider, Cline 모두 불가능한 기능이다. 그러나 현재 이 강점이 README에서 하단에 묻혀 있고, 예제 레포가 없다.

**4. 로컬 모델 first-class:**
`type: "gemma"`, LM Studio `baseURL` 설정으로 인터넷 없는 환경에서 동작 가능. 보안 중시 환경에서의 경쟁력.

### Robota가 아직 약한 영역

**1. git 통합:**
Aider의 핵심 강점은 코드 변경 시 자동 커밋, diff 기반 워크플로우다. Robota는 `/commit`, `/status`, `/diff` 슬래시 커맨드가 없다. 백로그(CLI-032)에 있지만 아직 미구현.

**2. 커뮤니티와 트랙션:**
npm 다운로드, GitHub Stars, Showcase 프로젝트가 경쟁사 대비 현저히 낮다. 기술이 좋아도 커뮤니티 없는 도구는 신뢰를 얻기 어렵다.

**3. UX 완성도:**
Claude Code는 수년간 다듬어진 제품이다. Robota는 기능은 유사하지만 미세한 UX들 (세션 자동 이름 부여, /cost 정확도, 도구 출력 truncation 알림)이 아직 개선 중이다.

---

## 4. 핵심 사용 시나리오별 UX

### 시나리오 A: 처음 설치하는 Node 20 사용자

```bash
$ npx @robota-sdk/agent-cli
```

**현재 경험:** Node 22 미달 시 즉시 실패. `UX-001` 백로그(Node.js 22+ 에러 메시지 개선)가 `high` 우선순위로 존재한다. 현재 npm 생태계의 주류 LTS는 Node 20이므로, 이 사용자가 첫 실행에서 이탈하는 비율이 높다.

**개선 필요:** 오류 메시지에 `nvm install 22 && nvm use 22` 또는 `volta install node@22` 명령을 직접 제시해야 한다.

### 시나리오 B: Anthropic API 키로 바로 시작

```bash
$ export ANTHROPIC_API_KEY=sk-ant-...
$ npx @robota-sdk/agent-cli
```

**현재 경험:** 키가 있어도 `~/.robota/settings.json`이 없으면 인터랙티브 설정 화면이 뜬다. 환경 변수만으로 즉시 실행되지 않는다.

환경 변수가 있는 경우에는 설정 화면을 건너뛰고 즉시 실행되는 경로가 있어야 한다. 이것이 Claude Code의 UX 패턴이기도 하다.

### 시나리오 C: CI 파이프라인에서 headless 사용

```bash
$ git diff | robota -p "Review this diff" --output-format json
```

**현재 경험:** stdin pipe 지원 있음, JSON 출력 지원 있음. 기능 자체는 구현되어 있다.

**문제점:** `--system-prompt` 플래그가 README에 문서화되어 있지만 `CLI-027` 백로그에 "실제 구현" 필요로 표시되어 있다. CLI 옵션에 문서화되어 있는 기능이 실제로는 미구현인 것은 심각한 신뢰 문제다. 테스트 없이 이 시나리오를 사용하다 실패하면 사용자가 이탈한다.

### 시나리오 D: 프로바이더 전환

```bash
# settings.json의 currentProvider를 "gpt-4o"로 변경 후
$ robota --provider gpt-4o
```

또는 TUI 내 `/provider` 커맨드를 통해 전환.

**현재 경험:** 기능이 구현되어 있다 (CLI-025 done). 그러나 TUI 내에서 즉시 확인하는 경험은 검증이 필요하다.

### 시나리오 E: 로컬 LM Studio 연결

```json
{
  "providers": {
    "local-gemma": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    }
  }
}
```

**현재 경험:** 설정 파일 수동 편집으로 가능하다. 자동 감지는 없다. "API 키 없이 로컬 모델로 시작하기" 경로가 있어야 하는데, 현재는 문서를 읽어야 알 수 있다.

---

## 5. 에러 메시지 및 도움말 품질

### CLI 인수 오류 (`cli-args.ts`)

유효하지 않은 값 입력 시 오류 메시지 예시:

```
Invalid --output-format "xml". Valid: text | json | stream-json
Invalid --permission-mode "admin". Valid: plan | default | acceptEdits | bypassPermissions
Invalid --max-turns "0". Must be a positive integer.
```

**평가:** 유효값을 명시하는 좋은 패턴이다. 다음 행동이 명확하다.

### 권한 오류 메시지

Permission prompt의 `Allow/Deny` UI는 TUI에서 화살표 키로 선택하는 방식이다. 그런데 Bash 명령을 실행할 때마다 approve를 요청하는 `default` 모드는 실무에서 사용 피로를 일으킨다. 백로그(CLI-030)에서 "세션-레벨 '이 세션에서 항상 허용' 옵션"을 `high` 우선순위로 다루고 있다.

### /help 출력

`help-command.ts`가 `formatCommandHelpMessage(context)`를 호출하여 등록된 모든 커맨드 목록을 동적으로 생성한다. 슬래시 커맨드 목록 + 설명이 출력된다.

**문제점:** `/help` 출력에 각 커맨드의 인수나 사용 예시가 없다. `/compact [instructions]`가 무엇을 하는지 설명은 있지만 예시(`/compact "keep code, remove examples"`)가 없다. Claude Code는 각 커맨드에 예시를 제공한다.

### 에러 메시지 UX 점수: 7/10

전반적으로 오류에 해결책을 포함하는 좋은 패턴이 있다. 그러나 일부 오류(--system-prompt 미구현, 도구 출력 30k 자 silently truncation)는 사용자가 인식하기 어렵다.

---

## 6. 문서화 및 마케팅 자료

### README 분석

**분량 및 구성:** 480줄, 12개 섹션. 설치, CLI 플래그, 프린트 모드, 첫 실행 설정, 내장 도구, 권한 시스템, 키보드 컨트롤, 붙여넣기 처리, 세션 관리, 슬래시 커맨드, 플러그인 관리, 설정, 컨텍스트 발견, 아키텍처, 의존성까지 망라.

**좋은 점:**

- `npx @robota-sdk/agent-cli` 한 줄로 시작 가능한 설치법이 상단에 있다
- 권한 모드 매트릭스(plan/default/acceptEdits/bypassPermissions × Read/Write/Bash)가 표로 정리되어 있어 한눈에 이해 가능
- stdin pipe 사용 예시(`git diff | robota -p "Summarize changes"`)가 구체적이다
- 설정 파일 예시 JSON이 현실적이고 복잡한 케이스(Qwen, Gemma 로컬 모델)까지 포함
- `--language` 파라미터 정도의 다국어 지원 언급

**문제점:**

- **스크린샷/GIF 없음.** TUI가 어떻게 생겼는지 이미지 없이 텍스트로만 설명한다. 경쟁사(Claude Code, Aider 모두 데모 GIF 보유) 대비 첫인상에서 크게 불리하다.
- **"왜 Robota인가?" 섹션 없음.** README가 "어떻게 쓰는가"에 집중하고 "왜 이것을 써야 하는가"는 없다. B2D 제품에서 개발자의 선택 근거가 중요한데, 경쟁사 대비 포지셔닝이 명시되지 않는다.
- **SDK 임베딩 예제 없음.** "Dependencies" 섹션에 `@robota-sdk/agent-framework`가 열거되어 있지만 이것을 어떻게 임베딩하는지 코드 예시가 없다. 가장 강한 차별점을 README에서 활용하지 못하고 있다.
- **베타 경고가 상단에 있지만 상태 불명확.** "Beta software — currently 3.0.0-beta" 한 줄이 전부다. 베타에서 GA까지의 타임라인, 무엇이 바뀔 수 있는지, 신뢰해도 되는 API는 무엇인지 없다.

### 다국어 README

`docs/README-KO.md` 링크가 상단에 있다. 한국어 README 존재. 이것은 한국 팀 제품이라는 정체성과 맞는 좋은 결정이다.

**문서화 점수: 6/10**

---

## 7. 설치~첫 대화 마찰 분석

### 현재 단계별 흐름

| 단계     | 행동                        | 예상 시간                     | 마찰 수준            |
| -------- | --------------------------- | ----------------------------- | -------------------- |
| 1        | `node --version` 확인       | 10초                          | 낮음                 |
| 2        | Node 22 미달 시 업그레이드  | 2~10분                        | **높음** (P0 블로커) |
| 3        | `npx @robota-sdk/agent-cli` | 30~60초 (패키지 다운로드)     | 낮음                 |
| 4        | 프로바이더 선택 인터랙션    | 1~2분                         | 보통                 |
| 5        | API 키 입력                 | 30초 (키 발급 포함 시 5~10분) | 보통~높음            |
| 6        | 언어 선택                   | 10초                          | 낮음                 |
| 7        | TUI 시작                    | 즉시                          | 낮음                 |
| 8        | 첫 메시지 입력              | —                             | 낮음                 |
| **합계** |                             | **3~15분**                    |                      |

**이상적인 목표:** 2분 이내 첫 응답. 현재 Node 22 문제가 없다면 3~4분 수준이다.

### 주요 마찰 포인트

**블로커 수준:**

- **Node 22+ 요구:** npm 주간 다운로드 기준 여전히 Node 20이 LTS 주류다. 첫 실행에서 `SyntaxError` 또는 버전 체크 실패를 만나는 사용자는 대부분 이탈한다.
- **macOS Terminal.app CJK 크래시:** `terminal-check.ts`에 경고 출력 코드는 있지만, 크래시 자체를 막지는 못한다. 한국/일본/중국어 입력이 필요한 개발자에게 실질적 블로커다.

**마찰 수준:**

- **환경 변수만으로 즉시 실행 안 됨:** `ANTHROPIC_API_KEY`가 설정되어 있어도 `settings.json`이 없으면 인터랙티브 설정이 필요하다. 헤드리스 환경(Docker, CI)에서 특히 문제다.
- **프로바이더 선택 화면이 텍스트 기반:** 어떤 프로바이더가 무료인지, 어디서 API 키를 받는지 링크가 없다.

**설치~첫 대화 마찰 점수: 6/10**

---

## 8. 슬래시 커맨드 발견성

### 등록된 슬래시 커맨드 전체 목록

`packages/agent-command/src/index.ts`에서 확인된 커맨드 모듈:

| 모듈        | 커맨드                                                       |
| ----------- | ------------------------------------------------------------ |
| session     | `/clear`, `/rename`, `/resume`, `/cost`, `/validate-session` |
| help        | `/help`                                                      |
| compact     | `/compact`                                                   |
| context     | `/context`                                                   |
| language    | `/language`                                                  |
| memory      | `/memory`                                                    |
| mode        | `/mode`                                                      |
| permissions | `/permissions`                                               |
| plugin      | `/plugin`                                                    |
| provider    | `/provider`                                                  |
| reset       | `/reset`                                                     |
| rewind      | `/rewind`                                                    |
| settings    | `/settings`                                                  |
| skills      | `/skills`                                                    |
| statusline  | `/statusline`                                                |
| background  | `/background`                                                |
| agent       | `/agent`                                                     |
| exit        | `/exit`                                                      |
| user-local  | (내부)                                                       |

**README 문서화 대비 실제 커맨드:**
README에는 `/help`, `/clear`, `/language`, `/compact`, `/cost`, `/context`, `/agent`, `/permissions`, `/plugin`, `/resume`, `/rename`, `/exit` 12개가 표시된다. 실제 코드에는 `/mode`, `/memory`, `/provider`, `/reset`, `/rewind`, `/settings`, `/skills`, `/statusline`, `/background`, `/validate-session`이 추가로 있다. **README 문서와 실제 구현 사이에 10개 커맨드 갭이 있다.**

### 발견성 메커니즘

**좋은 점:**

- `/` 입력 시 자동완성 팝업이 뜬다. 화살표 키로 탐색, Tab으로 삽입 가능.
- `/help` 명령이 등록된 모든 커맨드를 동적으로 열거한다.
- 하위 커맨드가 있는 경우(`/permissions`) 중첩 서브메뉴를 지원한다.
- `.agents/skills/` 및 `.claude/commands/`의 커스텀 스킬이 자동으로 자동완성에 등장한다.

**문제점:**

- `/help` 출력에 각 커맨드의 사용 예시가 없다. 설명만 있다.
- `/validate-session`처럼 사용자가 직접 쓸 일이 없는 내부 커맨드가 목록에 노출될 수 있다.
- README와 실제 커맨드 목록이 동기화되지 않았다. 사용자가 README를 보고 기대하는 것과 실제 `/help` 출력이 다르다.

**슬래시 커맨드 발견성 점수: 7/10**

---

## 9. PMF 분석

### 핵심 문제 정의

Robota가 해결하는 문제:

1. **벤더 종속성 (Vendor Lock-in):** "Claude Code를 쓰려면 Anthropic만 써야 한다." → Robota는 한 설정 파일로 5+ 프로바이더를 전환.
2. **구독 비용:** "$20/월 없이 내 API 키로 쓰고 싶다." → BYOK(Bring Your Own Key).
3. **프라이버시/보안:** "코드를 외부 서버에 올리기 싫다." → 로컬 모델 + 텔레메트리 없음.
4. **임베딩 불가능:** "우리 제품에 AI 코딩 어시스턴트를 넣고 싶다." → SDK 임베딩 가능.

### 현재 PMF 강도

| 페르소나              | 문제 크기     | Robota 해결력 | PMF 점수                |
| --------------------- | ------------- | ------------- | ----------------------- |
| Claude Code 탈출자    | 중            | 높음          | 7/10                    |
| 비용 절감 추구자      | 중            | 높음          | 7/10                    |
| 로컬 모델 사용자      | 중            | 중            | 6/10                    |
| SDK 임베더            | 크 (블루오션) | 중            | 5/10 (예제 부재로 낮음) |
| CI/CD 자동화 엔지니어 | 중            | 중            | 6/10                    |

### PMF 관점 결론

**가장 강한 PMF 후보:** "TypeScript 개발자가 자기 앱/서비스에 AI 코딩 어시스턴트를 임베딩하고 싶을 때" — 이 문제를 해결하는 경쟁자가 없다. 그러나 현재 이 경로의 진입이 너무 어렵다 (예제 레포 없음, Getting Started에 없음).

**현재 채택 경로:** 개인 개발자가 Claude Code 대안을 찾을 때. 이 경로는 경쟁이 심하고 (Aider, Cline도 같은 포지션) 차별화가 약하다.

**전략 제언:** SDK 임베딩을 "주" 포지셔닝으로, CLI를 "쇼케이스 + 기여 경로"로 재배치하면 차별화가 명확해진다.

---

## 10. 출시 준비도 체크리스트

### P0 — 출시 블로커 (미해결 시 Product Hunt 런칭 불가)

| 항목                                                       | 현재 상태           | 백로그 ID |
| ---------------------------------------------------------- | ------------------- | --------- |
| Node.js 22 진입 장벽 — 명확한 오류 메시지                  | 부분 구현           | CLI-028   |
| macOS Terminal.app CJK 크래시 근본 해결 또는 graceful 처리 | 경고만 있음         | CLI-029   |
| `--system-prompt` 실제 구현                                | 미구현, 문서만 있음 | CLI-027   |
| Bash 권한 피로 해소 (세션-레벨 항상 허용)                  | 미구현              | CLI-030   |

### P1 — 출시 전 권고 사항

| 항목                                    | 현재 상태 | 백로그 ID |
| --------------------------------------- | --------- | --------- |
| 빈 프로젝트 온보딩 가이드               | 미구현    | PM-023    |
| /cost 정확도 개선                       | 미구현    | PM-025    |
| README 스크린샷/데모 GIF                | 없음      | -         |
| SDK 임베딩 예제 (README 수준)           | 없음      | PM-029    |
| DASHSCOPE_API_KEY 진단에 추가           | 없음      | -         |
| README와 실제 슬래시 커맨드 목록 동기화 | 불일치    | -         |

### P2 — GA 전 완성 사항

| 항목                            | 현재 상태 | 백로그 ID |
| ------------------------------- | --------- | --------- |
| 공식 GitHub Action              | 없음      | PM-026    |
| 환경 변수 있을 때 설정 건너뛰기 | 없음      | -         |
| git 통합 슬래시 커맨드          | 없음      | CLI-032   |
| opt-in 익명 텔레메트리          | 없음      | PM-030    |
| 커뮤니티 베타 초대 프로그램     | 없음      | PM-028    |

### 전체 출시 준비도 점수

| 영역             | 점수       | 비고                              |
| ---------------- | ---------- | --------------------------------- |
| 기술 안정성      | 7.5/10     | 아키텍처 견고, 미구현 플래그 이슈 |
| FTUE             | 6.5/10     | Node 장벽, CJK 크래시             |
| 문서화           | 6/10       | GIF 없음, SDK 예제 없음           |
| 온보딩 완성도    | 6/10       | `robota init` 기능 있지만 갭 있음 |
| 경쟁 포지셔닝    | 7/10       | 차별점 명확하나 마케팅 미흡       |
| 에러 UX          | 7/10       | 기본 패턴 좋음, 일부 미비         |
| 슬래시 커맨드 UX | 7/10       | 자동완성 좋음, /help 예시 부족    |
| **종합**         | **67/100** |                                   |

**결론: 지금 당장 Product Hunt 런칭은 P0 이슈(CJK 크래시, Node 장벽, --system-prompt 미구현) 해결 후 권고.**

---

## 11. 권고 개선사항 (우선순위별)

### P0 — 즉시 (1주 이내)

**[P0-1] `--system-prompt` 실제 구현 완료**

- 현재 README에 문서화되어 있지만 미구현이다 (백로그 CLI-027).
- CI/CD 자동화 유즈케이스에서 핵심 기능이다.
- 문서화된 기능이 동작하지 않는다는 것은 신뢰 손상 1순위다.

**[P0-2] Node.js 버전 오류 메시지 개선**

- `diagnose-command.ts`에 이미 `nvm install 22 && nvm use 22`, `volta install node@22` 안내가 있다.
- 이것을 `npx` 실행 진입점에도 적용해야 한다. Node 체크 실패 시 즉시 이 메시지가 출력되어야 한다.

**[P0-3] macOS CJK 크래시 — `terminal-check.ts` 경고를 크래시 방지로 강화**

- 현재 `warnIfTerminalAppOnMacOS()`가 경고를 출력하지만 크래시를 막지 않는다.
- 최소한 "headless 모드를 사용하세요: `robota -p '프롬프트'`" 안내를 더 강조해야 한다.

### P1 — 단기 (2주 이내)

**[P1-1] README에 데모 GIF/스크린샷 추가**

- 경쟁 도구(Aider, Claude Code) 모두 데모 GIF를 갖고 있다.
- TUI 화면을 `asciinema`나 `terminalizer`로 녹화해서 README 상단에 넣어야 한다.
- 구현 시간: 2시간 이내.

**[P1-2] `robota init` 완료 후 프로바이더 설정 인라인 진행**

- 현재 `init` 완료 후 `robota --configure`를 별도로 실행해야 한다.
- `robota init`이 끝날 때 "API 키를 지금 설정할까요? [y/N]" 프롬프트를 추가하면 온보딩이 완결된다.

**[P1-3] 빈 프로젝트 온보딩 가이드 (백로그 PM-023)**

- AGENTS.md가 없는 폴더에서 실행 시 "이 프로젝트에 AGENTS.md가 없습니다. `robota init`으로 시작해보세요" 안내.
- 또는 첫 실행 웰컴 메시지에 `robota init`이 아직 실행 안 된 경우 `robota init` 실행 제안.

**[P1-4] Bash 권한 피로 해소 (백로그 CLI-030)**

- `default` 모드에서 Bash 실행마다 권한 요청이 뜨는 것은 실무에서 사용성을 크게 저해한다.
- Permission prompt에 "이 세션에서 항상 허용" 옵션 추가가 시급하다.

**[P1-5] `diagnose` 커맨드에 DASHSCOPE_API_KEY 추가 및 네트워크 체크 개선**

- 현재 Qwen 키(DASHSCOPE_API_KEY)가 진단에서 누락되어 있다.
- 네트워크 체크를 현재 설정된 프로바이더 엔드포인트 기준으로 변경.

### P2 — 중기 (1개월 이내)

**[P2-1] SDK 임베딩 예제를 README 상단으로 이동**

- "5줄로 AI 코딩 어시스턴트를 내 앱에 임베딩하기"를 README의 "강점" 섹션으로 올려야 한다.
- 실제 동작하는 최소 예제 코드 스니펫이 있어야 한다.

**[P2-2] /help 커맨드에 각 커맨드 예시 추가**

- `/compact [instructions]` 다음에 `Example: /compact "keep code, remove comments"` 같은 예시.
- `help-command.ts`의 `formatCommandHelpMessage` 함수 개선.

**[P2-3] README와 실제 슬래시 커맨드 목록 동기화**

- `/mode`, `/memory`, `/provider`, `/rewind`, `/settings`, `/skills`, `/statusline`, `/background`, `/validate-session`이 README에 없다.
- 이중에서 사용자가 직접 쓸 커맨드들(`/provider`, `/rewind`, `/settings` 등)은 문서화해야 한다.

**[P2-4] 환경 변수 감지 시 설정 단계 건너뛰기**

- `ANTHROPIC_API_KEY`가 설정되어 있으면 `settings.json` 없어도 즉시 실행되는 경로.
- CI/Docker 환경에서 설치 마찰을 크게 줄인다.

**[P2-5] /cost 세션별 비용 정확도 개선 (백로그 PM-025)**

- 비용 절감이 핵심 가치인데 `/cost`가 정확한 달러 금액을 보여주지 못하면 이 가치 제안이 약해진다.
- 프로바이더별 토큰 단가 테이블 내장이 필요하다.

### P3 — 장기 (출시 이후)

**[P3-1] 공식 GitHub Action (백로그 PM-026)**

- `robota-sdk/action@v1` — PR 리뷰 봇을 10줄 YAML로 시작하는 공식 Action.
- CI/CD 포지셔닝의 실질적 증거.

**[P3-2] opt-in 익명 텔레메트리 (백로그 PM-030)**

- 현재 어디서 이탈하는지 데이터가 전혀 없다. 제품 개선이 추정 기반이다.

**[P3-3] 한국어 마케팅 콘텐츠 (백로그 PM-027)**

- GeekNews, okky, velog 타겟 콘텐츠.
- 한국 팀 제품이므로 한국 개발자 커뮤니티에서 초기 트랙션을 만들기 유리하다.

**[P3-4] SDK Starter Kit 레포 (백로그 PM-029)**

- `github.com/robota-sdk/starter-kit` — Next.js, Express, CLI script 임베딩 템플릿.
- SDK 임베딩 차별점을 실증하는 가장 강력한 마케팅 자료.

---

_본 보고서는 코드베이스 직접 분석 기반이다. 인용된 오류 메시지와 UX 흐름은 실제 소스 파일에서 추출했다._
