**Language:** [English](README.md) | [한국어](README.ko.md)

# @robota-sdk/agent-cli

Robota SDK 기반의 AI 코딩 어시스턴트 CLI. AGENTS.md/CLAUDE.md를 로드하여 프로젝트 컨텍스트를 파악하고, Claude Code 호환 권한 모드를 갖춘 도구 호출 REPL을 제공합니다.

## 시스템 요구사항

**Node.js 22 이상** 필요합니다.

```bash
node --version  # v22.x.x 이상이어야 합니다
```

Node.js 버전이 22 미만이라면 [nvm](https://github.com/nvm-sh/nvm)으로 업그레이드:

```bash
nvm install 22
nvm use 22
```

## 설치

```bash
# 전역 설치
npm install -g @robota-sdk/agent-cli

# 또는 npx로 직접 실행
npx @robota-sdk/agent-cli
```

> **macOS Terminal.app 사용자**: 한국어/중국어/일본어 입력 시 크래시가 발생할 수 있습니다. **[iTerm2](https://iterm2.com/)** 사용을 권장합니다. 이는 Ink + Terminal.app의 알려진 문제로 Claude Code와 동일합니다.

전역 설치 후 시스템 전체에서 `robota` 명령어를 사용할 수 있습니다:

```bash
robota                        # 인터랙티브 REPL
robota "프롬프트"              # 초기 프롬프트와 함께 REPL 시작
robota -p "파일 목록 출력"     # 출력 모드 (단발성, 응답 후 종료)
```

### 환경 변수

| 변수                | 설명                                     | 필수 여부      |
| ------------------- | ---------------------------------------- | -------------- |
| `ANTHROPIC_API_KEY` | Anthropic 프로바이더용 API 키            | Anthropic 전용 |
| `DEEPSEEK_API_KEY`  | DeepSeek 프로바이더용 API 키             | DeepSeek 전용  |
| `DASHSCOPE_API_KEY` | Qwen(알리바바 클라우드) 모델 스튜디오 키 | Qwen 전용      |

실행 전 키를 설정하세요:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## 개발 환경 설정 (모노레포)

```bash
# 의존성 및 CLI 빌드
pnpm build:deps
pnpm --filter @robota-sdk/agent-cli build
```

## 실행 (모노레포)

```bash
# 모노레포 루트에서
cd packages/agent-cli

# 개발 모드 (빌드 불필요)
pnpm dev

# 프로덕션 모드 (빌드 필요)
pnpm start

# 인자 포함 실행
pnpm dev -- --version
pnpm dev -- --permission-mode plan
pnpm dev -- -p "src/ 내 모든 TypeScript 파일 목록"
```

## CLI 플래그

```
robota                              # 인터랙티브 REPL (기본 모드)
robota "프롬프트"                   # 초기 프롬프트와 함께 REPL 시작
robota -p "프롬프트"                # 출력 모드 (단발성, 응답 후 종료)
robota -c                           # 마지막 세션 이어서 시작
robota -r <session-id>              # 세션 ID로 세션 재개
robota --model <모델>               # 모델 지정 (예: claude-sonnet-4-6)
robota --language <언어>            # 응답 언어 (ko, en, ja, zh)
robota --permission-mode <모드>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # 인터랙션당 에이전틱 턴 제한
robota --output-format <형식>       # text | json | stream-json (출력 모드)
robota --system-prompt <텍스트>     # 시스템 프롬프트 교체 (출력 모드)
robota --append-system-prompt <텍스트> # 시스템 프롬프트에 추가 (출력 모드)
robota --reset                      # 사용자 설정 삭제 후 종료
robota --check-update               # npm에서 최신 CLI 버전 확인 후 종료
robota --disable-update-check       # 이번 실행에서 시작 시 업데이트 확인 건너뜀
robota --version                    # 버전 표시
```

### CLI 업데이트 확인

```bash
robota --check-update
```

업데이트가 있으면 npm 전역 설치 명령어를 출력합니다:

```bash
npm install -g '@robota-sdk/agent-cli@latest'
```

### 출력 모드 형식

출력 모드(`-p`)는 `--output-format`으로 세 가지 형식을 지원합니다:

| 형식          | 설명                                                             |
| ------------- | ---------------------------------------------------------------- |
| `text`        | 표준 출력에 일반 텍스트 응답 (기본값)                            |
| `json`        | 단일 JSON 객체: `{ type, result, session_id, subtype }`          |
| `stream-json` | `content_block_delta` 스트리밍 이벤트를 줄바꿈으로 구분한 NDJSON |

### 표준 입력(Stdin) 파이프

`-p`와 위치 인자 없이 stdin이 파이프되면 CLI가 stdin에서 읽습니다:

```bash
echo "이 오류를 설명해줘" | robota -p
cat file.ts | robota -p "이 코드를 검토해줘" --output-format json
git diff | robota -p "변경 사항 요약" --output-format stream-json
```

## 최초 실행 설정

사용 가능한 설정 파일이 없으면 CLI가 다음을 안내합니다:

1. **프로바이더 선택** — CLI 바이너리에 포함된 프로바이더 중 선택
2. **프로바이더별 설정** — 모델, base URL, 마스킹된 API 키 등
3. **응답 언어** (ko/en/ja/zh, 기본값: en)

`~/.robota/settings.json`에 설정이 저장됩니다. `robota --reset`으로 최초 실행 상태로 되돌릴 수 있습니다.

## 내장 도구

AI 에이전트는 8개의 로컬 도구를 호출할 수 있습니다:

| 도구        | 설명                          | 주요 인자  |
| ----------- | ----------------------------- | ---------- |
| `Bash`      | 셸 명령 실행                  | `command`  |
| `Read`      | 줄 번호와 함께 파일 내용 읽기 | `filePath` |
| `Write`     | 파일에 내용 쓰기              | `filePath` |
| `Edit`      | 파일의 문자열 교체            | `filePath` |
| `Glob`      | 패턴으로 파일 검색            | `pattern`  |
| `Grep`      | 정규식으로 파일 내용 검색     | `pattern`  |
| `WebFetch`  | URL 내용을 텍스트로 가져오기  | `url`      |
| `WebSearch` | 인터넷 검색                   | `query`    |

## 권한 시스템

모든 도구 호출은 세 단계 권한 게이트를 통과합니다:

1. **거부 목록** — 거부 패턴이 일치하면 차단
2. **허용 목록** — 허용 패턴이 일치하면 자동 승인
3. **모드 정책** — 활성 권한 모드에 따라 결정

### 권한 모드

| 모드                | Read/Glob/Grep | Write/Edit | Bash |
| ------------------- | :------------: | :--------: | :--: |
| `plan`              |      자동      |    거부    | 거부 |
| `default`           |      자동      |    승인    | 승인 |
| `acceptEdits`       |      자동      |    자동    | 승인 |
| `bypassPermissions` |      자동      |    자동    | 자동 |

### 런타임 모드 변경

`/permissions` 슬래시 커맨드 사용:

```
> /permissions                    # 현재 모드 및 세션 승인 도구 표시
> /permissions plan               # 읽기 전용 모드로 전환
> /permissions bypassPermissions  # 모든 프롬프트 건너뜀
```

또는 시작 시 설정:

```bash
robota --permission-mode plan
```

### 권한 패턴

`.robota/settings.json` 또는 `.robota/settings.local.json`에 설정:

```json
{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Bash(git status)", "Read(/src/**)"],
    "deny": ["Bash(rm -rf *)", "Write(.env)"]
  }
}
```

패턴 문법: `ToolName`은 모든 호출에 매칭; `ToolName(pattern)`은 셸 스타일 글로브(`*`, `**`)로 주요 인자에 매칭.

## 키보드 단축키

| 키        | 동작                                       |
| --------- | ------------------------------------------ |
| Enter     | 입력 제출                                  |
| ESC       | 현재 실행 중단 (부분 응답 저장)            |
| Ctrl+C    | 즉시 프로세스 종료                         |
| Up/Down   | 여러 줄 입력에서 줄 탐색                   |
| 화살표 키 | 슬래시 커맨드 자동완성, 권한 프롬프트 탐색 |

## 주요 슬래시 커맨드

| 커맨드                | 설명                                            |
| --------------------- | ----------------------------------------------- |
| `/help`               | 사용 가능한 커맨드 표시                         |
| `/clear`              | 대화 기록 초기화                                |
| `/model [모델명]`     | AI 모델 변경 (확인 프롬프트, CLI 재시작)        |
| `/language [언어]`    | 응답 언어 설정 (ko, en, ja, zh), 저장 후 재시작 |
| `/compact [지시사항]` | 컨텍스트 창 압축                                |
| `/cost`               | 세션 정보 표시                                  |
| `/context`            | 컨텍스트 창 상세, 참조 목록, 자동 압축 설정     |
| `/agent`              | 백그라운드 서브에이전트 작업 실행 및 관리       |
| `/permissions [모드]` | 권한 규칙 표시 또는 권한 모드 변경              |
| `/plugin [하위명령]`  | 플러그인 관리                                   |
| `/resume`             | 최근 세션 목록 표시 및 재개                     |
| `/rename <이름>`      | 현재 세션 이름 변경                             |
| `/exit`               | CLI 종료                                        |

## 세션 관리

### CLI 플래그

| 플래그                | 설명                                     |
| --------------------- | ---------------------------------------- |
| `-c`, `--continue`    | 가장 최근 세션 이어서 시작               |
| `-r`, `--resume <id>` | 특정 세션 ID로 재개                      |
| `--fork-session <id>` | 세션 포크 (복사된 기록으로 새 세션 시작) |
| `--name <이름>`       | 시작 시 세션에 이름 지정                 |

## 설정

설정은 다음 순서로 병합됩니다 (낮은 우선순위 → 높은 우선순위):

1. `~/.robota/settings.json` (사용자 전역)
2. `~/.claude/settings.json` (사용자 전역, Claude Code 호환)
3. `.robota/settings.json` (프로젝트, 공유)
4. `.robota/settings.local.json` (로컬, gitignore 대상)
5. `.claude/settings.json` (프로젝트, Claude Code 호환)
6. `.claude/settings.local.json` (로컬, gitignore 대상, Claude Code 호환)

```json
{
  "defaultMode": "default",
  "language": "ko",
  "currentProvider": "claude-sonnet-4-6",
  "providers": {
    "claude-sonnet-4-6": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  },
  "permissions": {
    "allow": ["Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

## 컨텍스트 자동 탐색

CLI는 다음을 자동으로 탐색하고 로드합니다:

- **AGENTS.md** — cwd에서 파일시스템 루트까지 상위 디렉토리 탐색
- **CLAUDE.md** — 동일한 상위 탐색
- **프로젝트 메타데이터** — `package.json`, `tsconfig.json`

모든 컨텍스트가 시스템 프롬프트로 조합됩니다.

## 세션 로깅

세션 로그는 JSONL 형식으로 `.robota/logs/{sessionId}.jsonl`에 기록됩니다. 재개 가능한 세션 JSON은 `.robota/sessions/{sessionId}.json`에 저장됩니다.

## 아키텍처

CLI는 순수 TUI 레이어입니다. 모든 비즈니스 로직은 `@robota-sdk/agent-sdk`의 `InteractiveSession`에 있습니다. `useInteractiveSession`이 유일한 React↔SDK 브릿지입니다.

## 라이선스

MIT
