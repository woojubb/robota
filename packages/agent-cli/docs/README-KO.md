**Language:** [English](../README.md) | [한국어](README-KO.md)

# @robota-sdk/agent-cli

`__PRODUCT_CLI_NAME__` is the configurable terminal interface for Robota, assembled from the
same TypeScript libraries you can embed. It is a coding-capable agent within the environment whose
direction is [our agents developing and advancing our agents](../../../VISION.md). Autonomous
self-evolution remains an ambition; the behavior below describes the current CLI. It reads your
project, edits files and runs commands under a permission system you control, and works with
Anthropic, OpenAI, Gemini, DeepSeek, Qwen, OpenRouter and local OpenAI-compatible models.

이 CLI는 여러분의 앱에서도 쓸 수 있는 같은 패키지들로 조립되어 있습니다. 세션은
`@robota-sdk/agent-framework`, 터미널 UI는 `@robota-sdk/agent-ui-terminal`, 모델 제공자는
`@robota-sdk/agent-provider`가 맡습니다. 이 에이전트를 쓰는 대신 직접 에이전트를 만들려면
[SDK 가이드](../../../content/guide/sdk.md)부터 보세요.

> **베타.** 정식 릴리스 전까지 동작이 바뀔 수 있습니다.
> [이슈를 알려 주세요](__PROJECT_REPOSITORY_URL__/issues).

## 설치

Node.js 22.12.0 이상이 필요합니다.

```bash
npm install -g @robota-sdk/agent-cli   # `__PRODUCT_CLI_NAME__` 명령을 설치합니다
npx @robota-sdk/agent-cli              # 설치하지 않고 한 번 실행합니다
```

Node.js가 없다면 설치 스크립트가 최신 GitHub 릴리스에서 플랫폼에 맞는 독립 실행 바이너리(arm64 또는 x64의
macOS와 Linux, x64의 Windows)를 내려받아 SHA-256을 검증한 뒤 `<configured-user-state-dir>/bin`에 설치합니다.

```bash
curl -fsSL https://raw.githubusercontent.com/woojubb/robota/main/scripts/install.sh | bash   # macOS, Linux
irm https://raw.githubusercontent.com/woojubb/robota/main/scripts/install.ps1 | iex          # Windows PowerShell
```

macOS의 Terminal.app에서는 한국어 등 CJK 입력기가 충돌을 일으킬 수 있습니다.
[iTerm2](https://iterm2.com/) 같은 다른 터미널을 쓰세요.

## npm 패키지로 별도 제품 만들기

애플리케이션은 배포된 `@robota-sdk/agent-cli`와 `@robota-sdk/product-config` 패키지에 의존하면서
자체 진입점, 정체성, 자산, 패키징을 소유할 수 있습니다. `/host` 진입점은 실행 파일 하나를 빌드 시점에
고정된 비밀이 아닌 정체성에 묶습니다. 이 진입점은 설치된 `__PRODUCT_CLI_NAME__` 바이너리와 별개이며, 그
바이너리에 대한 `startCli`/`startCliEntry` 직접 호출은 여전히 내장 정체성을 강제합니다. 명시적인 빌드
설정에서 `embeddedProductIdentity`로 만든 리터럴 정체성을 넘기면, 호스트가 어떤 세션이 시작되기 전에 그
정체성을 검증하고 스냅샷으로 고정합니다.

```ts
import { createProductCliHost } from '@robota-sdk/agent-cli/host';
import { productIdentity } from './product-identity.js';
import { productVersion } from './product-version.js';

const host = createProductCliHost({
  identity: productIdentity,
  version: productVersion,
  update: false,
  // webRoot: --serve --open을 쓸 때, 이 제품이 빌드한 브라우저 자산의 절대 경로
});
await host.run();
```

같은 진입점이 일반 실행, 데몬 시작, 스스로 포크한 워커에서 모두 실행되어야 합니다. 호스트는
`runtimeDefaults`가 검증된 홈 기준 상대 경로를 주지 않는 한, 정체성에서 상태, 캐시, 로그 루트를 따로
파생합니다. 운영 설정은 호출 시점에 선택됩니다. 업데이트 확인은 산출물이 자체 npm 패키지와 레지스트리를
명시하지 않으면 꺼져 있습니다. `sourceVersion`을 생략하면 소비자 산출물의 버전을 쓰고, 빌드 메타데이터를
생략하면 null입니다.

`@robota-sdk/agent-cli/desktop-host`는 신뢰 승인, 선별된 CLI 자식 프로세스 환경, 데몬 시작과 재연결,
엄격한 루프백 엔드포인트 파싱, 그에 맞는 CSP를 제공합니다. 소비자의 Electron 메인 프로세스가 창, 네이티브
신뢰 프롬프트, 자식 프로세스 실행, CSP 설치를 맡고, 프리로드가 IPC를 맡으며, 렌더러는
`@robota-sdk/agent-ui-web/client`를 씁니다. 데스크톱 도우미는 CLI가 신뢰 명령과 데몬 명령에 답한 뒤에만
엔드포인트를 돌려줍니다. 소비자는 자체 렌더러 파일과, 사이드카로 쓸 같은 제품 바인딩 CLI 진입점을
패키징합니다.

`@robota-sdk/agent-cli/native-build`는 절대 경로의 소비자 진입점에서 호스트와 일치하는 Bun 빌드(이
저장소는 Bun 1.4.2로 빌드합니다)를 만드는 `buildProductNativeBinary`를 export합니다. 컴파일 전에 Koffi의
설치된 네이티브 애드온을 검증하고, 소비자가 관리하는 서드파티 고지 파일의 절대 경로를 요구하며 그 파일을
바이너리 옆에 복사합니다. 네이티브 애드온 빌드는 호스트가 macOS, Linux, Windows 중 맞는 것이어야 하고,
컴파일된 바이너리는 워커와 데몬을 위해 내장된 진입점으로 다시 들어갑니다. 서명과 데스크톱 패키징은 호출자
몫입니다. 브라우저 자산 루트를 줄 때는 소비자가 패키징한 절대 경로 디렉터리여야 하며, 이를 주지 않는
소비자 호스트는 SDK의 기본 제공 모니터 자산을 서빙하지 않습니다. 네이티브 빌더를 호출하기 전에
`e2b@2.51.0`을 CLI와 함께 설치하세요. 네이티브 컴파일은 E2B를 포함한 호스티드 기능 전체를 내장하므로,
결과 바이너리에는 인접한 SDK 패키지가 필요 없습니다.

## 첫 실행

Git 저장소 안에서 `__PRODUCT_CLI_NAME__`를 실행합니다. 먼저 이 폴더를 신뢰할지 묻습니다. 프로젝트 자체의 설정,
훅, 스킬, 플러그인, MCP 서버는 신뢰한 워크스페이스에서만 불러옵니다. 신뢰하지 않으면 세션은
**Restricted** 상태로 시작하며, 사용자 설정과 기본 도구만 씁니다. 처음 실행할 때는 웹 검색 서버를
추가할지도 묻고([웹 검색하기](#웹-검색하기) 참고), 이어서 제공자를 고르고 그 항목(모델, 기본 URL, API 키)을 채우는
과정을 안내한 뒤, 프로필을 `<configured-user-state-dir>/settings.json`에 저장합니다.

```bash
cd my-project
__PRODUCT_CLI_NAME__
```

서버처럼 입력 프롬프트 없이 설정하려면, 플래그로 프로필을 만들고 워크스페이스를 신뢰합니다.
프로필에는 키 자체가 아니라 환경 변수에 대한 참조가 저장되며, 명령을 실행할 때 그 변수가 설정되어
있어야 합니다.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
__PRODUCT_CLI_NAME__ --configure-provider anthropic --type anthropic --model claude-sonnet-4-6 \
  --api-key-env ANTHROPIC_API_KEY --set-current
__PRODUCT_CLI_NAME__ trust --yes
```

`__PRODUCT_CLI_NAME__ init`은 현재 프로젝트에 기본 `AGENTS.md`와 `<configured-project-state-dir>/settings.json`을 만듭니다.
`__PRODUCT_CLI_NAME__ --configure`는 대화형 제공자 설정을 다시 실행하고, `__PRODUCT_CLI_NAME__ --reset`은
`<configured-user-state-dir>/settings.json`을 삭제합니다.

## 할 수 있는 일

### 터미널 UI에서 작업하기

`__PRODUCT_CLI_NAME__`는 대화형 세션을 시작합니다. 요청을 입력하거나 `/`를 눌러 명령 메뉴를 엽니다(`/help`는 모든
명령을 보여 줍니다). `Esc`는 진행 중인 응답을 멈추고, `Ctrl+R`은 이전에 입력한 프롬프트를 검색하며,
모든 키는 `<configured-user-state-dir>/keybindings.json`에서 다시 지정할 수 있습니다
([키 바인딩 가이드](../../../content/guide/keybindings.md) 참고).

에이전트는 파일·셸 도구(`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`), `WebFetch`,
`AskUserQuestion`을 쓰며, 서브에이전트와 백그라운드 작업에 일을 넘길 수 있습니다. 신뢰한 워크스페이스에서는
프로젝트의 `AGENTS.md`와 `CLAUDE.md`를 컨텍스트로 불러오고, 프롬프트에 `@path`를 쓰면 프로젝트 파일을 첨부합니다.

```bash
__PRODUCT_CLI_NAME__                              # 새 세션
__PRODUCT_CLI_NAME__ --permission-mode acceptEdits
__PRODUCT_CLI_NAME__ --screen-reader              # 스크린 리더용 일반 텍스트 모드
```

### 스크립트에서 프롬프트 하나 실행하기

프린트 모드(`-p`)는 터미널 UI 없이 프롬프트 하나를 실행하고 종료합니다. 프롬프트 인자가 없으면
파이프로 들어온 stdin에서 프롬프트를 읽습니다.

```bash
__PRODUCT_CLI_NAME__ -p "List the TypeScript files in src/"
__PRODUCT_CLI_NAME__ -p "Summarize this repository" --output-format json   # JSON 객체 하나: result, session_id
cat task.md | __PRODUCT_CLI_NAME__ -p                                      # stdin에서 프롬프트 읽기
__PRODUCT_CLI_NAME__ -p "Review this diff" --bare                          # AGENTS.md, CLAUDE.md, 플러그인 없이 실행
__PRODUCT_CLI_NAME__ --goal "make the failing tests pass"                  # 여러 턴에 걸쳐 목표를 향해 작업
```

`--output-format`은 `text`(기본값), `json`, `stream-json` 중 하나입니다. `--json-schema`는 스키마에
맞는 JSON 응답을 요청하고, `--system-prompt` / `--append-system-prompt`는 이번 실행의 시스템
프롬프트를 바꿉니다. 종료 코드는 성공이면 `0`, 오류면 `1`입니다. 사용할 수 있는 제공자 설정이
없으면 `-p`는 `3`으로 끝나고, 목표에 도달하지 못하고 멈춘 `--goal` 실행은 `2`로 끝납니다. 신뢰하지
않은 Git 저장소에서는 프린트 모드, `--goal`, `--serve`, `__PRODUCT_CLI_NAME__ mcp serve`, `__PRODUCT_CLI_NAME__ daemon start`,
`__PRODUCT_CLI_NAME__ session start`가 시작을 거부합니다. 앞의 네 가지는 `--safe-mode`나 `--restricted-workspace`를 붙이면
대신 Restricted 상태로 실행되고, `__PRODUCT_CLI_NAME__ daemon start --restricted-workspace`와
`__PRODUCT_CLI_NAME__ session start --restricted-workspace`는 Restricted로 시작합니다.

### 세션 이어 가기, 백그라운드 실행, 데몬 공유

세션은 저장되므로 나중에 다시 돌아올 수 있습니다.

```bash
__PRODUCT_CLI_NAME__ -c                           # 가장 최근 세션 이어 가기
__PRODUCT_CLI_NAME__ -r <id-or-name>              # 세션 재개
__PRODUCT_CLI_NAME__ -r <id> --fork-session       # 원본은 그대로 두고 복사본으로 이어 가기
__PRODUCT_CLI_NAME__ -n "refactor auth"           # 새 세션에 이름 붙이기
```

세션 안에서는 `/resume`으로 세션을 바꾸고, `/rename`으로 현재 세션 이름을 정하고, `/fork`로 대화를
백그라운드 세션에 복사하고, `/cd <directory>`로 대화를 다른 디렉터리로 옮깁니다.

감독(supervised) 세션은 터미널을 닫아도 계속 실행되고, 워크스페이스 데몬은 터미널과 데스크톱 앱이
함께 쓰는 오래 사는 런타임 하나입니다. 아직 신뢰하지 않은 폴더에서는 데스크톱 앱이 데몬을 시작하기 전에
창에서 신뢰할지, Restricted로 시작할지, 종료할지 묻습니다.

```bash
__PRODUCT_CLI_NAME__ session start --background --name nightly
__PRODUCT_CLI_NAME__ session list
__PRODUCT_CLI_NAME__ session attach <supervised-id>          # --observe를 붙이면 읽기 전용으로 지켜봅니다
__PRODUCT_CLI_NAME__ daemon start                            # 그다음: __PRODUCT_CLI_NAME__ --attach
__PRODUCT_CLI_NAME__ daemon stop
```

[세션과 데몬](../../../content/guide/sessions-and-daemon.md)을 참고하세요.

### 에이전트가 할 수 있는 일 통제하기

모든 도구 호출은 deny 규칙, ask 규칙, allow 규칙을 거친 뒤 권한 모드로 결정됩니다.

| 모드                | 읽기 | 파일 수정 | 셸 명령                               |
| ------------------- | ---- | --------- | ------------------------------------- |
| `plan`              | 허용 | 거부      | 거부(기본 제공 읽기 전용 명령은 예외) |
| `default`           | 허용 | 물어봄    | 물어봄                                |
| `acceptEdits`       | 허용 | 허용      | 물어봄                                |
| `auto`              | 허용 | 허용      | 모델 분류기가 결정                    |
| `bypassPermissions` | 허용 | 허용      | 허용                                  |

모드는 `--permission-mode <mode>`로 정하거나(`--dry-run`은 `plan`과 같습니다) 세션 안에서
`/permissions <mode>`로 바꿉니다. `/permissions`만 입력하면 적용 중인 규칙과 최근 거부 내역을 보여
줍니다. 규칙은 어느 설정 파일에나 둘 수 있습니다.

```json
{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Bash(git status)"],
    "ask": ["Bash(git push *)"],
    "deny": ["Bash(rm -rf *)", "Write(.env)"]
  }
}
```

`ask` 규칙은 `bypassPermissions`에서도 물어보며, 몇 가지 동작은 어떤 모드에서도 자동 승인되지
않습니다. 루트·홈·작업 디렉터리에 대한 `rm`, 그리고 `.git`, `<configured-project-state-dir>`, `.claude`, `.agents`나 셸·도구
설정 파일에 쓰는 동작이 그렇습니다.

셸 명령은 OS 샌드박스(Linux는 bubblewrap, macOS는 Seatbelt) 안에서 실행할 수도 있습니다.
`/sandbox`는 `auto-allow`, `regular`, `off` 사이를 전환하고, `sandbox` 설정 키로 구성합니다.
샌드박스에 갇힌 명령은 `<configured-user-state-dir>` 아래의 자격 증명이 든 파일
(`settings.json`, `credentials/`, `mcp-credentials/`, `remote-host-identity.json`, `secure/`,
`secure-v1/`)을 읽을 수 없습니다.

에이전트가 실행하는 명령(도구, 훅, 백그라운드 셸, 스킬의 `!` 명령, MCP 헤더 도우미)은 제공자 프로필이
자격 증명으로 쓰는 변수, 즉 `$ENV:` 참조와 `OPENAI_API_KEY` 같은 각 제공자의 기본 키 변수를 물려받지
않습니다. 런타임 자신은 여전히 그 변수로 인증합니다. 명령이 변수 하나를 보게 하려면 사용자 설정에
`"commandEnvAllow": ["OPENAI_API_KEY"]`처럼 적으세요(프로젝트 설정으로는 할 수 없습니다). MCP 서버
정의에서 명시적으로 참조한 변수는 그대로 해석됩니다. 세션 중에 추가한 `$ENV:` 참조도 다음 시작부터는
명령에 전달되지 않습니다.

뭔가 이상하게 동작하면 `__PRODUCT_CLI_NAME__ --safe-mode`로 지시 파일, 스킬, 플러그인, 훅, MCP 서버를 모두 끈 채
시작해 보세요.

신뢰 관리 프로세스가 실행되는 동안 승인 당시의 실제 폴더에 대한 신뢰가 유지됩니다. CLI를 다시 켜도 재승인할
필요는 없지만, 관리 프로세스나 컴퓨터를 재시작하면 다시 승인해야 합니다.
`<configured-user-state-dir>/workspace-trust.json`은 승인 이력만 기록하며 신뢰를 자동 복원하지 않습니다.

```bash
__PRODUCT_CLI_NAME__ trust status    # 이 워크스페이스를 신뢰하는가? 신뢰하면 무엇을 불러오는가? (--json: 한 줄 JSON)
__PRODUCT_CLI_NAME__ trust --yes     # 현재 폴더의 신뢰를 요청하고 터미널에서 확인
__PRODUCT_CLI_NAME__ trust revoke --yes
```

[권한과 훅](../../../content/guide/permissions-and-hooks.md)을 참고하세요.

### 제공자와 모델 고르기

`providers`의 각 제공자 프로필은 `type`(`anthropic`, `openai`, `gemini`, `deepseek`, `qwen`,
`gemma`, `openrouter`)과 모델, 그리고 선택적으로 기본 URL과 API 키를 지정하며, `currentProvider`가 사용할 프로필을
고릅니다. 설정 과정은 키를 환경 변수 참조로 채워 넣습니다.

| 제공자 타입  | 기본 키 변수         | 비고                                                               |
| ------------ | -------------------- | ------------------------------------------------------------------ |
| `anthropic`  | `ANTHROPIC_API_KEY`  |                                                                    |
| `openai`     | `OPENAI_API_KEY`     | `baseURL`로 다른 OpenAI 호환 엔드포인트도 사용                     |
| `gemini`     | `GEMINI_API_KEY`     |                                                                    |
| `deepseek`   | `DEEPSEEK_API_KEY`   |                                                                    |
| `qwen`       | `DASHSCOPE_API_KEY`  | Alibaba Cloud Model Studio                                         |
| `gemma`      | 없음                 | 로컬 Gemma 모델. 기본 URL은 LM Studio의 `http://localhost:1234/v1` |
| `openrouter` | `OPENROUTER_API_KEY` | 브라우저로 연결(`/provider add openrouter`)하거나 API 키로 연결    |

```json
{
  "currentProvider": "claude",
  "providers": {
    "claude": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  }
}
```

세션 안에서는 `/provider list`, `/provider switch <profile>`, `/provider add`, `/provider test`로
프로필을 관리합니다. 한 번의 실행에 대해서는 `--provider <profile>`로 프로필을 고르고(`--set-current`를
붙이면 기본값이 됩니다), `--model`로 모델을 덮어쓰고, `--fallback-model a,b`로 첫 모델이 과부하일 때
다른 모델에서 턴을 이어 가고, `--effort <level>`로 모델 effort를 정하고, `--advisor <profile[:model]>`로
모델이 두 번째 모델에게 조언을 구하게 할 수 있습니다. [제공자](../../../content/guide/providers.md)와
[로컬 LLM 설정](../../../content/guide/local-llm.md)을 참고하세요.

### 웹 검색하기

웹 검색은 두 가지 방법으로 모델에 닿으며, 둘을 함께 쓸 수 있습니다.

- **모델 자체 검색.** Anthropic과 자체 API의 OpenAI는 기본적으로 서버 측에서 검색하며,
  검색 비용은 해당 업체가 청구합니다. 끄려면 프로필에
  `"options": { "nativeWebTools": { "webSearch": false } }`를 지정하세요.
  `nativeWebTools`를 지정한 프로필은 쓴 그대로 적용됩니다. 이 CLI의 도구와 함께 쓸 수 있는
  검색 도구를 업체가 제공하지 않는 경우에는 꺼져 있습니다. 사용자 지정 `baseURL`, Chat Completions,
  `OPENAI_BASE_URL`을 쓰는 OpenAI 프로필과 `gpt-4.1-nano`처럼 웹 검색이 없는 OpenAI 모델이
  여기에 해당합니다. Anthropic 답변이 웹을 인용하면 끝에 `[Sources]` 목록이 붙습니다.
  Gemini는 프로필에 `"webSearch": true`를 지정할 때만 검색하며, Gemini 3 이상이 필요합니다.
  Google [약관](https://ai.google.dev/gemini-api/terms)은 검색 기반 결과를 보여 주고 저장하는 데
  조건을 두고 있고, 터미널은 약관이 요구하는 검색 제안을 표시할 수 없으니 먼저 읽어 보세요.
- **직접 고르는 MCP 서버.** 어떤 모델이든 MCP 서버로 검색할 수 있습니다. 처음 대화형으로 시작하면
  Exa(`https://mcp.exa.ai/mcp`)나 Parallel(`https://mcp.parallel.ai/mcp`)을 추가할지, 건너뛸지 한 번
  묻습니다. 둘 다 API 키가 필요 없으며, 검색어는 고른 서비스로 전송됩니다. 선택은
  `<configured-user-state-dir>/settings.json`의 `mcpServers`에 저장되고 승인되어, 그 세션에서 바로 연결됩니다.
  나중에는 `__PRODUCT_CLI_NAME__ mcp add exa`, `__PRODUCT_CLI_NAME__ mcp add parallel`,
  `__PRODUCT_CLI_NAME__ mcp add <name> <https-url>`로 묻지 않고 같은 일을 할 수 있습니다. 이 경우 서버는 다음
  실행에서 연결되며, `/mcp revoke <name>`으로 승인을 거둘 수 있습니다. 아래처럼 `mcpServers`에 검색 서버를
  직접 선언해도 됩니다.

### MCP 서버 연결하기, 또는 에이전트 세션을 MCP로 제공하기

원격 MCP 서버는 설정 파일의 `mcpServers` 아래에 선언합니다. 선언한 서버는 승인하기 전까지 연결되지
않습니다. `/mcp`는 각 서버의 상태를 보여 주고, `/mcp approve <server>`는 승인을 기록한 뒤
실행 중인 세션에서 연결을 시도합니다. 승인은 `<configured-user-state-dir>/mcp-approvals.json`에 저장되어 다음 실행에도
이어지며, 서버 정의나 프로젝트 신뢰가 바뀌면 다시 승인해야 합니다. OAuth를 쓰는 서버는 로그인도
필요합니다. 세션 안에서는 `/mcp login <server>`, 터미널에서는 `__PRODUCT_CLI_NAME__ mcp login <server>`를 쓰며,
승인된 서버는 로그인하면 실행 중인 세션에 연결됩니다. `__PRODUCT_CLI_NAME__ mcp add <name> <https-url>`은 HTTP 서버를
사용자 설정에 추가하고 한 번에 승인합니다.

```json
{
  "mcpServers": {
    "docs": { "type": "http", "url": "https://mcp.example.com/mcp", "oauth": {} }
  }
}
```

HTTP나 stdio 정의에서 `"protocolVersion": "2026-07-28"`을 명시적으로 고르면 무상태(stateless) 피어를 쓸 수
있습니다. 레거시 핸드셰이크를 쓰려면 이 필드를 생략하세요. 값을 바꾸면 다시 승인해야 하고, 지원하지 않는
값은 조용히 무시되지 않고 거부됩니다. 선택한 버전은 정의 상세에 표시됩니다. 시작할 때 사용할 수 없는
클라이언트 입력, 구독, 확장 기능을 알려 줍니다. 이 버전을 고르는 것만으로는 분산 스킬이 켜지지 않으며
서버에 추가 권한이 생기지도 않습니다. 피어가 광고하는 스킬 확장을 정의 단위로 켜려면 `"skills": true`를
추가하세요. 이 선택을 바꾸면 서버를 새로 승인해야 합니다. `/mcp skill-list <server>`는 메타데이터만
읽습니다. 로컬 터미널이나 앱 사용자는 `/mcp skill-inspect <server> <uri>`로 검토한 뒤, 그 결과에 나온
`/mcp skill-approve <server> <uri> <fingerprint>` 명령을 복사해 해당 지시문과 frontmatter에 정확히
동의할 수 있습니다. `/mcp skill-withdraw <server> <uri>`는 그 동의를 거둡니다. 콘텐츠 결정은
`<configured-user-state-dir>/mcp-skill-approvals.json`에 따로 저장되며 호스트 출처, 워크스페이스, URI에
묶입니다. 매니페스트가 바뀌거나 사라진 것을 관찰하면, 피어가 나중에 되돌려도 동의는 철회된 채로 남습니다.
검색은 지원되는 각 스킬의 정확한 호출 이름을 돌려주며, 프로필을 쓸 수 없으면 그 이유를 돌려줍니다. 그
이름을 세션의 스킬 명령으로 호출하세요. 지시문은 실제 턴이 시작될 때, 현재 콘텐츠 동의 아래에서만
로드되며, 그 턴이 끝나거나 취소되면 활성화도 닫힙니다. 대기열에 있거나 취소된 요청은 다른 턴에 지시문을
로드하지 않습니다. 원격 셸 표현식은 지시문 텍스트로 남고 로컬 전처리로 실행되지 않습니다. 활성 실행 중에는
`/skill-read ["<invocation-name>", "<resource-uri>"]`로 목록에 있는 보조 파일을 새로 검증해서 읽을 수
있습니다. 포크는 자신의 활성화에서 나온 파일만 읽을 수 있고, 중첩된 SKILL.md는 따로 승인하고 활성화하기
전까지 보조 데이터로 남습니다.

MCP 호출은 디스패치 직전에 승인과 현재 소스를 다시 확인합니다. 정의를 제거하거나 바꾸거나, 승인을
철회하거나, 필요한 워크스페이스 신뢰를 바꾸거나, 컴포지션을 닫으면 유지된 도구를 통한 새 호출은 거부됩니다.
이미 디스패치된 호출은 실제 결과를 그대로 유지하며, 철회는 롤백이 아닙니다. 설정이 바뀌면 기존 도구
체인에 새 연결을 조용히 끼워 넣지 않고 새로 시작하고 다시 승인해야 합니다.

`__PRODUCT_CLI_NAME__ mcp serve`는 그 반대입니다. 에이전트 세션 하나를 stdio로(또는 `--http-*`, `--oauth-*` 플래그로
인증된 HTTP로) MCP 호스트에 제공합니다. 먼저 프로젝트를 신뢰하고, 호스트에는 `__PRODUCT_CLI_NAME__`의 절대 경로와
프로젝트 디렉터리를 알려 줍니다.

```json
{
  "mcpServers": {
    "__PRODUCT_CLI_NAME__": {
      "command": "/absolute/path/to/__PRODUCT_CLI_NAME__",
      "args": ["mcp", "serve"],
      "cwd": "/absolute/path/to/trusted/project"
    }
  }
}
```

[MCP](../../../content/guide/mcp.md)를 참고하세요.

### 스킬, 명령, 에이전트, 플러그인 추가하기

스킬과 명령은 CLI가 `<configured-project-state-dir>/skills/`, `.claude/skills/`, `.claude/commands/`, `.agents/skills/`에서
찾는 Markdown 파일입니다. 신뢰한 프로젝트와 홈 디렉터리 양쪽에서 찾습니다. 각각이 슬래시 명령
(`/<name>`)이 되고, `/skills`가 목록을 보여 줍니다. 에이전트 정의는 `<configured-project-state-dir>/agents/`,
`.agents/agents/`, `.claude/agents/`에서 읽습니다. 플러그인은 이것들을 훅, 테마, MCP 서버와 함께
묶습니다.

```text
/plugin marketplace add <source>
/plugin install <name>@<marketplace>
/plugin                              # 플러그인 관리자 열기
```

스킬 frontmatter와 플러그인 관리는 [CLI 가이드](../../../content/guide/cli.md)를 참고하세요.

### 그래픽 인터페이스 쓰기

`__PRODUCT_CLI_NAME__ --serve --open`은 현재 워크스페이스용 헤드리스 런타임을 시작하고, configured GUI를
`127.0.0.1`에서 제공하며, 브라우저에서 엽니다. 이 저장소의 Electron 데스크톱 앱
([`apps/agent-app`](../../../apps/agent-app/docs/README.md))은 워크스페이스 데몬 위에서 같은 GUI를
보여 주며, npm에는 배포되지 않습니다.

### 다른 앱과 서비스에서 에이전트 쓰기

`__PRODUCT_CLI_NAME__ --serve --http-port <port>`는 에이전트를 `127.0.0.1:<port>`의 HTTP로도 제공하므로, 다른
애플리케이션이나 서비스가 Robota 클라이언트 라이브러리 없이 에이전트를 쓸 수 있습니다. 모든 요청은
`__PRODUCT_ENV_PREFIX__HTTP_TOKEN`에 직접 정한 bearer(32자 이상)를 제시해야 합니다. 런타임은 이 값을 환경에서 지우므로
실행하는 명령이 물려받지 않습니다. 같은 OS 사용자로 실행되는 명령은 OS 샌드박스가 가두지 않는 한(또는
서버를 별도 사용자로 실행하지 않는 한) 서버의 시작 환경을 여전히 읽을 수 있으므로, 서버에서는 샌드박스를
켜세요. bearer를 쓰면 루프백에만 바인딩합니다.

다른 곳에서 접근하려면 직접 만든 리버스 프록시나 터널을 앞에 두거나, `__PRODUCT_CLI_NAME__ mcp serve`와 같은 방식으로
OAuth 리소스 서버로 제공하세요. `--http-public-url`, `--oauth-issuer`, `--oauth-scopes`,
`--oauth-allowed-subjects`(선택적으로 `--http-host <ip>`와 `--trusted-proxy`)를 주고
`__PRODUCT_ENV_PREFIX__HTTP_TOKEN`은 주지 않습니다. 그러면 클라이언트는 해당 발급자가 발급한 액세스 토큰을 제시해야
하며, 그 토큰의 audience는 공개 URL이고 요구하는 스코프를 갖고 허용된 subject를 가리켜야 합니다. 아래
경로는 공개 URL의 경로 아래에서 제공되며, RFC 9728 메타데이터는
`/.well-known/oauth-protected-resource<path>`에서 제공됩니다.

```bash
__PRODUCT_ENV_PREFIX__HTTP_TOKEN="$(openssl rand -hex 32)" __PRODUCT_CLI_NAME__ --serve --http-port 8787
__PRODUCT_CLI_NAME__ --serve --http-port 8787 --http-host 0.0.0.0 \
  --http-public-url https://agents.example.com/agent --oauth-issuer https://auth.example.com \
  --oauth-scopes agent.run --oauth-allowed-subjects client-a
```

| 요청                                                        | 동작                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /submit` `{"prompt": "...", "receivePrompts"?: true}` | 턴을 실행하고 SSE(`text_delta`, `complete`, `error`. `receivePrompts`를 주면 `permission_request`, `ask_request`, `prompt_resolved`도)로 스트리밍. 턴이 실행 중이면 `409` |
| `GET /prompts` · `POST /prompts/<id>` `{"result": true}`    | 열려 있는 권한/질문 프롬프트 목록 · 하나에 응답(질문에는 `{"response": ...}`)                                                                                             |
| `POST /command` `{"name": "help", "args": ""}`              | 슬래시 명령 실행                                                                                                                                                          |
| `POST /abort` · `POST /cancel-queue`                        | 실행 중인 턴 중단 · 대기 중인 프롬프트 폐기                                                                                                                               |
| `GET /messages` · `/context` · `/executing` · `/pending`    | 대화와 그 상태 읽기                                                                                                                                                       |

`receivePrompts: true`로 제출한 클라이언트는 자기 턴이 일으키는 권한 및 질문 프롬프트에 응답합니다. 이를
주지 않으면 다른 클라이언트가 응답하지 않는 질문은 거부되므로, 서버가 실행되는 권한 모드와 규칙을 신중히
고르세요.

`__PRODUCT_CLI_NAME__ acp`는 에이전트를 stdio로 편집기(Zed, JetBrains 등 [Agent Client Protocol](https://agentclientprotocol.com/)
클라이언트)에 제공합니다. 편집기가 프로젝트 폴더를 작업 디렉터리로 하여 `__PRODUCT_CLI_NAME__ acp`를 실행하도록
설정하세요. 워크스페이스 신뢰, 권한, 샌드박스는 터미널과 같이 적용되며, 터미널이라면 승인을 물었을 모든
도구 호출을 편집기가 승인하도록 묻습니다.
[편집기](../../../content/guide/cli.md#editors-agent-client-protocol)를 참고하세요.

### 세션을 읽기 전용으로 지켜보기

`__PRODUCT_CLI_NAME__ --serve --observer-port <port>`는 지켜보기만 하는 두 번째 WebSocket 리스너를
`127.0.0.1:<port>`에 엽니다. 이 리스너는 자체 토큰을 쓰며, `__PRODUCT_ENV_PREFIX__OBSERVER_TOKEN`에 직접 정한 값(32자
이상)이어야 합니다. 토큰을 새로 만들지 않으며, 런타임은 stderr에
`Observer listening on ws://127.0.0.1:<port> (read-only)`만 출력합니다. 클라이언트는 드라이버 리스너와
마찬가지로 토큰을 `?token=`이나 WebSocket 서브프로토콜로 제시합니다. 토큰과 포트는 드라이버 리스너의
것, 그리고 `__PRODUCT_ENV_PREFIX__HTTP_TOKEN`·`--http-port`와 달라야 합니다. 같은 자격 증명을 공유하면 읽기 전용 토큰을
가진 쪽이 다른 리스너로 세션을 조작할 수 있기 때문입니다. 사용 중인 포트는 다음 포트로 옮겨 가지 않고
시작을 실패시킵니다.

```bash
__PRODUCT_ENV_PREFIX__OBSERVER_TOKEN="$(openssl rand -hex 32)" __PRODUCT_CLI_NAME__ --serve --observer-port 7171
```

관찰자는 세션의 대화와 상태, 그리고 호스트의 세션 목록을 읽습니다. 프롬프트 제출, 프롬프트 응답, 명령
실행, 중단, 세션 전환이나 시작, 설정 쓰기는 할 수 없고 프롬프트를 받지도 않으며, `drive` 역할을 요청하면
거부됩니다. 관찰자는 런타임이 시작한 세션에 참여하며, 드라이버가 다른 세션으로 전환해도 따라가지 않습니다.
관찰자의 연결이 끊어져도 세션과 런타임은 계속되고, 다시 연결하면 같은 세션에 참여합니다. 런타임은 토큰을
환경에서 지우므로 실행하는 명령이 물려받지 않지만, 같은 OS 사용자로 실행되는 명령은 OS 샌드박스가 가두지
않는 한 서버의 시작 환경을 여전히 읽을 수 있으므로 서버에서는 샌드박스를 켜세요. 보안 런타임과 호스티드
태스크 워커는 이 플래그를 거부하며, 이 플래그는 `--serve`와 함께일 때만 유효합니다.

### 다른 세션과 다른 기기에 닿기

`/peers`는 이 컴퓨터에서 실행 중인 다른 `__PRODUCT_CLI_NAME__` 세션을 보여 주고, `/peers send <session-id>
<message>`는 그중 하나에 메시지를 보냅니다. 받는 세션은 그 메시지를 자기 작업과 똑같이 자신의 권한
아래에서 처리합니다. `/handoff <session-id>`는 양쪽이 확인하면 이 대화를 다른 세션으로 옮깁니다.
다른 기기에도 닿으려면 `/devices init`으로 기기 ID를 만들고, 새 기기를 `/devices add`와
`/devices join`으로 연결한 뒤, 사용자 설정에서 `transports.mesh.enabled`를 `true`로 설정합니다.
`/remote-control enable`은 브라우저를 페어링해 현재 세션을 함께 조작하게 합니다.

[기기와 원격 제어](../../../content/guide/devices-and-remote.md)를 참고하세요.

### 보안 대화용 키링 만들기

```bash
__PRODUCT_CLI_NAME__ secure setup              # 키링 생성. 복구 키는 한 번만 보여 줍니다
__PRODUCT_CLI_NAME__ secure status             # 키링 파일, 슬롯, 키 지문 (패스프레이즈 불필요)
__PRODUCT_CLI_NAME__ secure verify             # 잠금 해제 후 저장된 키 확인 (--recovery: 복구 키 사용)
__PRODUCT_CLI_NAME__ secure change-passphrase  # 새 패스프레이즈 설정 (--recovery: 잊은 패스프레이즈 재설정)
__PRODUCT_CLI_NAME__ secure enable             # 기존 대화를 옮긴 뒤 보안 모드를 켭니다
__PRODUCT_CLI_NAME__ secure disable            # 새 대화에 대해 보안 모드를 끕니다
```

패스프레이즈와 복구 키는 요청할 때 터미널에서 직접 입력하며, 인자로 주거나 환경 변수나 파이프에서
읽지 않으므로 에이전트의 셸 도구처럼 자기 터미널이 없는 프로그램은 대신 실행할 수 없습니다. 내 계정으로
실행되는 모든 프로그램이 키링 파일을 읽을 수 있으므로, 이 파일을 지키는 것은 패스프레이즈(12자 이상, 짧은
패턴을 되풀이한 것이 아닌 것)입니다. 키링 파일은 키의 유일한 사본이며, 패스프레이즈를 바꿔도 누군가 이미
가져간 사본은 막지 못합니다. 키링을 만드는 것만으로는 세션이 저장되는 방식이 바뀌지 않습니다.

보안 대화는 선택 사항입니다. `secure setup` 뒤에, 모든 Robota 세션을 닫고 대화형 터미널에서
`secure enable`을 실행하세요. 키링을 검증하고 지원되는 기존 대화 데이터를 옮기며, 평문 대화 데이터가
남아 있으면 활성화를 거부합니다. 보고된 문제를 해결한 뒤 다시 시도하세요. 대화나 포크된 워크트리를 조용히
버리지 않습니다. macOS와 Linux에서 보안 CLI 대화를 쓸 수 있습니다. Windows는 평문 CLI 대화를 유지하며,
그곳에서는 `secure enable`과 보안 세션 시작이 거부됩니다. 보안 데스크톱 대화는 macOS에서 쓸 수 있습니다.
보안 모드가 켜져 있는 동안 새 대화는 전용 `secure-v1` 저장 영역을 씁니다. 데스크톱 앱은 열고 나서
**File → Unlock Secure Conversation…**이 필요하며, 창을 닫거나 새로고침하면 세션이 잠기고 보내지 않은
초안과 첨부 파일 경로가 버려집니다. `secure disable`은 터미널 확인과 현재 버전 세션의 종료를 요구합니다.
그 뒤 새 대화는 평문 저장소를 쓰며, 봉인된 보관본과 키링은 그대로 남습니다. 보안 모드가 켜져 있는 동안
이전 버전의 Robota를 이 상태에 대고 실행하지 마세요. 이전 버전은 보안 모드 선택을 따를 수 없습니다.

### 설정과 사용량 확인하기

```bash
__PRODUCT_CLI_NAME__ doctor            # 설정 계층, 제공자, 신뢰, 저장소, 플러그인, 훅, MCP
__PRODUCT_CLI_NAME__ usage             # 최근 7일의 세션, 턴, 토큰, 비용 (--period 30d)
__PRODUCT_CLI_NAME__ --check-update    # npm에 새 버전이 있는가?
__PRODUCT_CLI_NAME__ eval <definition> # evals-as-code 정의 실행. 지표 위반 시 1로 종료
```

## 설정 파일

설정은 다음 파일들을 우선순위가 낮은 것부터 병합합니다. 사용자 파일 두 개는 항상 적용되고, 프로젝트
파일 네 개는 신뢰한 워크스페이스에서만 적용됩니다.

| 파일                                                 | 범위                              |
| ---------------------------------------------------- | --------------------------------- |
| `<configured-user-state-dir>/settings.json`          | 사용자                            |
| `~/.claude/settings.json`                            | 사용자 (Claude Code 호환)         |
| `<configured-project-state-dir>/settings.json`       | 프로젝트, 저장소에 커밋           |
| `<configured-project-state-dir>/settings.local.json` | 프로젝트, 이 컴퓨터 전용          |
| `.claude/settings.json`                              | 프로젝트 (Claude Code 호환)       |
| `.claude/settings.local.json`                        | 프로젝트, 로컬 (Claude Code 호환) |

CLI가 `<configured-user-state-dir>/` 아래에 두는 그 밖의 파일:

| 경로                   | 내용                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `workspace-trust.json` | 승인 이력. 실제 신뢰는 관리 프로세스가 유지                                               |
| `sessions/`            | 저장된 세션 (신뢰한 프로젝트는 `<configured-project-state-dir>/sessions/`에 둘 수도 있음) |
| `history.jsonl`        | `Ctrl+R`용으로 입력한 프롬프트 (`"promptHistory": false`로 끔)                            |
| `keybindings.json`     | 키 바인딩                                                                                 |
| `themes/`              | 직접 만든 `/theme` 테마                                                                   |
| `plugins/`             | 설치한 플러그인 (프로젝트는 자체 `<configured-project-state-dir>/plugins/`를 둘 수 있음)  |
| `mcp-credentials/`     | MCP 서버용 OAuth 토큰, 본인만 읽을 수 있음                                                |
| `secure/keyring.json`  | 보안 대화용 키링, 패스프레이즈와 복구 키로 보호됨                                         |

## 코드에서 쓰기

이 패키지는 `__PRODUCT_CLI_NAME__` 실행 파일이 실행하는 완전한 진입점인 `startCliEntry`와 그 옵션 타입
`IStartCliOptions`를 export합니다. 이 함수는 설정된 진단, 대화형 크래시 정책, 시작 오류 처리를 설치한 뒤
`startCli`를 호출합니다. 호스트가 그 프로세스 정책을 직접 맡는다면 `startCli`를 바로 쓰세요. 패키지는 ESM
전용이므로 `require()`가 아니라 `import`로 불러오세요.

서브에이전트는 워커 플래그를 붙여 진입 스크립트를 다시 시작한 자식 프로세스에서 실행됩니다.
`startCliEntry()`나 `startCli()`가 그 플래그를 보면 CLI 대신 서브에이전트를 실행하고, 반환된 프로미스는
끝나지 않습니다(워커가 프로세스를 끝냅니다). Node가 시작한 스크립트에서 진입점을 호출하고, 서브에이전트마다
한 번씩 실행되면 안 되는 일은 그 앞에 두지 마세요.

일반 내장 진입점은 다른 제품의 표준 변수가 있어도 자기 정체성을 유지합니다. 설치된 진입점은 표준 운영
값을 `PRODUCT_ID`가 일치할 때만 받아들이며, 제품 접두사가 붙은 별칭과 명시적인 호스트 파일 선택은 계속 쓸
수 있습니다. 내장되지 않은 라이브러리의 명시적 `environment`, `productConfig`, `productConfigFile` 옵션은
호스트가 구성하는 입력입니다. 실행 전에 프로세스 환경의 제품 변수는 해석된 호출로 교체되어, 생성되는 도구와
워커가 그 제품을 물려받습니다. 여러 호출을 실행하는 임베딩 호스트는 자체 환경 스냅샷을 유지하고 넘겨야
합니다.

헤드리스 Restricted 시작은 무시한 프로젝트 설정 파일을 stderr에 알립니다. 신뢰하지 않은 폴더에서의
거부는 설정된 `<cli> trust --yes` 명령을 알려 줍니다.

호스티드 태스크 워커 실행(`HostedOrganizationControl`, `createHostedOrganizationGateway`,
`provisionE2BTaskWorker` 등)과 원격 데스크톱 소유자 구성(`HostedDesktopGateway` 등)은 이 패키지가 함께
export하며, 소유자 백엔드를 위한 것입니다. 자세한 내용은 영어 README의
[호스티드 태스크 워커 실행](../README.md#hosted-task-worker-execution)과
[원격 데스크톱 소유자 구성](../README.md#remote-desktop-owner-composition)을 참고하세요.

## 이 저장소에서 CLI 개발하기

```bash
pnpm install && pnpm build
pnpm cli:dev          # 소스에서 CLI 실행
pnpm cli:trust        # 소스 CLI가 이 저장소를 신뢰하도록 설정
```

## 문서

- [CLI 가이드](../../../content/guide/cli.md) — 모든 명령, 플래그, 설정
- [세션과 데몬](../../../content/guide/sessions-and-daemon.md)
- [권한과 훅](../../../content/guide/permissions-and-hooks.md)
- [제공자](../../../content/guide/providers.md)와 [로컬 LLM 설정](../../../content/guide/local-llm.md)
- [MCP](../../../content/guide/mcp.md)
- [기기와 원격 제어](../../../content/guide/devices-and-remote.md)
- [SPEC.md](./SPEC.md) — 이 패키지가 맡는 것과 보장하는 것

## 라이선스

이 패키지는 [GNU AGPL-3.0](../../../LICENSE) 또는 [상용 라이선스](../../../COMMERCIAL.md)로 이중
라이선스됩니다. [LICENSING.md](../../../LICENSING.md)를 참고하세요.
