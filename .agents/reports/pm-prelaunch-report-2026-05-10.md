# PM 사전 출시 점검 보고서

**작성일**: 2026-05-10
**대상**: Robota agent-cli 서비스 (`@robota-sdk/agent-cli`)
**조사 방법**: 실제 파일 직접 읽기 (README, SPEC.md, CHANGELOG, package.json, 소스코드, 백로그)

---

## 서비스 현황 요약

| 항목             | 내용                                                     |
| ---------------- | -------------------------------------------------------- |
| 버전             | 3.0.0-beta.61                                            |
| 상태             | Beta (npm에 `beta` 태그로 배포 완료)                     |
| npm 패키지명     | `@robota-sdk/agent-cli`                                  |
| 설치 명령        | `npm install -g @robota-sdk/agent-cli`                   |
| 실행 명령        | `robota`                                                 |
| Node.js 요구사항 | >=22.0.0 (높음 — 주의 필요)                              |
| 라이선스         | MIT                                                      |
| 지원 채널        | GitHub Issues (https://github.com/woojubb/robota/issues) |
| 홈페이지         | https://robota.io/                                       |

**주요 지원 기능**: 대화형 TUI REPL, 파일 읽기/쓰기/편집, Bash 실행, 웹 검색/페치, 세션 저장/복원, 멀티 프로바이더 전환, 권한 시스템, 백그라운드 서브에이전트, 플러그인 관리, 컨텍스트 압축

**지원 AI 프로바이더**: Anthropic (Claude), OpenAI 호환, DeepSeek, Qwen (Alibaba), Gemma (LM Studio 로컬), Google Gemini

---

## 출시 준비도 스코어카드

| 영역          | 상태 | 점수(1-5) | 비고                                                                                      |
| ------------- | ---- | --------- | ----------------------------------------------------------------------------------------- |
| 사용자 온보딩 | ⚠️   | 3         | README는 충실하나 Node 22+ 요구사항이 진입장벽. 첫 실행 설정 흐름은 있음                  |
| 핵심 기능     | ✅   | 4         | 8개 내장 도구, 19개 슬래시 커맨드 패키지, 멀티 프로바이더 — Claude Code 수준에 근접       |
| 문서화        | ⚠️   | 3         | README는 상세하나 공개 docs 사이트 콘텐츠 최소화. 일반 사용자용 가이드 부족               |
| 안정성        | ⚠️   | 3         | 아키텍처 건전성 확인됨. 앱 단 테스트 없음. macOS Terminal.app CJK 크래시 알려진 버그 존재 |
| 수익화        | ⚠️   | 2         | 크레딧/인증 패키지는 컨트랙트 정의 단계. 실제 결제/과금 플로우 미구현                     |

---

## 기능 현황

### 구현된 주요 기능

#### 내장 도구 (8개)

| 도구        | 기능                    |
| ----------- | ----------------------- |
| `Bash`      | 쉘 명령 실행            |
| `Read`      | 파일 읽기 (줄번호 포함) |
| `Write`     | 파일 쓰기               |
| `Edit`      | 파일 문자열 교체        |
| `Glob`      | 패턴 파일 검색          |
| `Grep`      | 정규식 파일 내용 검색   |
| `WebFetch`  | URL 콘텐츠 가져오기     |
| `WebSearch` | 인터넷 검색             |

#### 슬래시 커맨드 패키지 (19개)

agent-command-agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, skills, statusline, user-local

구현된 주요 커맨드:

- `/help` — 도움말
- `/clear` — 대화 이력 삭제
- `/model [model]` — AI 모델 선택 (재시작 포함)
- `/language [lang]` — 응답 언어 설정 (ko/en/ja/zh)
- `/compact [instructions]` — 컨텍스트 압축
- `/cost` — 세션 사용 정보
- `/context` — 컨텍스트 창 상세 및 참조 관리
- `/agent` — 백그라운드 서브에이전트 실행/관리
- `/permissions [mode]` — 권한 모드 조회/변경
- `/plugin` — 플러그인 설치/관리 TUI
- `/resume` — 최근 세션 목록 및 재개
- `/rename <name>` — 세션 이름 지정
- `/rewind` — 편집 체크포인트 롤백
- `/memory` — 프로젝트 메모리 관리
- `/provider` — 프로바이더 프로파일 관리

#### 권한 시스템

- 4가지 퍼미션 모드: `plan`, `default`, `acceptEdits`, `bypassPermissions`
- 패턴 기반 허용/거부 목록 (glob 지원)
- Claude Code 호환 훅 시스템 (PreToolUse, UserPromptSubmit, Stop 등)

#### 세션 관리

- 세션 저장/복원 (`-c`, `-r` 플래그)
- 세션 포크 (`--fork-session`)
- 세션 명명 (`--name`, `/rename`)
- JSONL 세션 로그 (`.robota/logs/`)

#### 프로바이더 관리

- 멀티 프로파일 설정 (동일 타입 다중 계정/엔드포인트)
- 대화형 첫 실행 설정 (설정파일 자동 생성)
- 런타임 프로바이더 전환 (`/provider`)
- `$ENV:VAR_NAME` 방식 API 키 환경변수 참조

#### TUI 컴포넌트

- React + Ink 기반 터미널 UI
- CJK 입력 지원 (단, macOS Terminal.app 제외)
- 브라켓 붙여넣기 모드 (멀티라인 감지)
- 슬래시 자동완성 팝업
- 편집 diff 블록 렌더링
- 마크다운/코드 구문 강조

### 미구현/부족한 기능

1. **공개 문서 사이트 콘텐츠 빈약**: `apps/docs/docs/`에 README.md와 SPEC.md만 존재. 패키지별 문서는 VitePress 빌드 시 복사되는 구조이나, 일반 사용자용 튜토리얼/가이드 부재.
2. **에이전트 서버 테스트 없음**: `apps/agent-server`에 테스트 파일 없음 (`--passWithNoTests`).
3. **웹 앱 테스트 없음**: `apps/agent-web`에 테스트 파일 없음 (`--passWithNoTests`).
4. **수익화 플로우 미연결**: `packages/credits`와 `packages/auth`는 타입 컨트랙트 정의만 존재. 실제 결제/크레딧 소비/인증 로직 없음.
5. **Google Gemini — 서버측만 지원**: agent-server에는 `@robota-sdk/agent-provider-google` 사용, CLI에는 `agent-provider-gemini` 사용으로 두 패키지 분리.
6. **macOS Terminal.app CJK 크래시**: README에 명시된 알려진 버그. iTerm2 권장 워크어라운드만 제시.
7. **`/rewind` 커맨드**: 구현됨으나 체크포인트 저장 기반 롤백 — 사용자 시나리오 완성도 확인 필요.
8. **Web playground 기능 범위 불명**: `apps/agent-web`은 playground UI만 제공, 실제 서비스 URL/배포 상태 불명확.

---

## 출시 전 필수 작업

### P0 (출시 차단 수준)

- [ ] **Node.js 22+ 요구사항 사용자 안내 강화**: Node 22는 2024년 10월 LTS 진입. 다수 사용자 환경이 Node 18/20일 수 있음. README에 명확한 버전 확인 명령 추가 또는 `.nvmrc` 제공.

  ```
  robota: /path/node: FAIL (Node 18 → >=22 required)
  ```

  현재 에러 메시지가 친절한지 확인 필요.

- [ ] **첫 실행 시 API 키 없을 때 에러 메시지 품질 검증**: 첫 실행 설정 흐름이 있으나, 잘못된 API 키 입력 시 사용자가 이해할 수 있는 메시지가 출력되는지 실제 확인.

### P1 (출시 전 강력 권고)

- [ ] **공개 docs 사이트 콘텐츠 보강**: https://robota.io/ 에 연결되는 VitePress 사이트(`apps/docs`)에 실제 사용자용 Getting Started 가이드, 슬래시 커맨드 레퍼런스, 프로바이더 설정 예시 추가. 현재 기술 SPEC만 존재.

- [ ] **macOS Terminal.app CJK 크래시 해결 또는 명시적 경고**: 현재 README에만 언급. 첫 실행 시 터미널 감지 후 경고를 표시하는 로직 고려.

- [ ] **README 한국어 사용자 가이드 또는 다국어 README 추가**: CLI가 한국어 응답 모드를 지원하고 팀이 한국어 기반인데, 설치 README는 영어만 제공.

- [ ] **앱 단 통합 테스트 추가**: `apps/agent-server`와 `apps/agent-web`의 핵심 경로(health endpoint, WebSocket auth, playground API)에 대한 기본 테스트 필요.

- [ ] **`robota --check-update` 정상 동작 확인**: npm에 beta.61이 배포되어 있음을 확인했으므로, 업데이트 체크 경로가 정상 작동하는지 실제 실행으로 검증.

### P2 (출시 후 단기 개선)

- [ ] **수익화 플로우 연결**: `packages/credits`와 `packages/auth`에 실제 구현 계층 추가 또는 로드맵 공개. 현재는 타입 정의만 존재.

- [ ] **Google Gemini 프로바이더 통일**: CLI용(`agent-provider-gemini`)과 서버용(`agent-provider-google`)이 분리되어 있어 혼란 가능성. 통합 또는 명확한 역할 분리 문서화.

- [ ] **plugin marketplace 레퍼런스 구현**: `/plugin install <name>@<marketplace>` 명령이 정의되어 있으나 실제 marketplace가 존재하지 않음.

- [ ] **Web playground 공개 배포 및 데모 경로 확인**: `apps/agent-web`의 `/playground/demo` 경로가 실제로 API 키 없이 동작하는지 확인.

---

## 기존 백로그 분석

### 통계

| 구분                                         | 수               |
| -------------------------------------------- | ---------------- |
| 현재 활성 백로그 (`.agents/backlog/*.md`)    | 27개             |
| 완료된 백로그 (`.agents/backlog/completed/`) | 58개             |
| 활성 백로그 중 status: done                  | 27개 (전체 done) |

**중요 발견**: 현재 `.agents/backlog/`의 모든 파일(README 제외)이 `status: done`이다. 즉, 현재 시점에서 미완료 활성 백로그가 없다.

### 완료된 주요 그룹

| 그룹                         | 항목 수 | 내용                                                     |
| ---------------------------- | ------- | -------------------------------------------------------- |
| ARCH-AUDIT (아키텍처 감사)   | 11개    | 모두 done — 아키텍처 문서 동기화 완료                    |
| ARCH-CONF (아키텍처 정합성)  | 8개     | 모두 done — 의존성 방향, React-free, zero-deps 검증 완료 |
| HOOK (Claude Code 훅 호환성) | 7개     | 모두 done — CC 호환 훅 시스템 구현 완료                  |
| CLI 관련 (completed/)        | ~30개   | 세션 관리, 슬래시 자동완성, CJK 입력, 프로바이더 전환 등 |
| SDK 관련 (completed/)        | ~15개   | 권한 기억, WebFetch 도구, 컨텍스트 관리 등               |

### 출시 관련 백로그 현황

현재 활성 백로그에는 출시를 차단하는 미완료 항목이 없다. 모든 추적된 작업이 `status: done`이며 증거 기록까지 완료된 상태.

### 우선순위 분포 (활성 백로그 기준)

- critical: 2개 (ARCH-AUDIT-001, 002 — 모두 done)
- high: 12개 (모두 done)
- medium: 12개 (모두 done)

---

## 경쟁 제품 대비 기능 갭

### Claude Code와 비교

| 기능                                    | Claude Code         | Robota | 비고                            |
| --------------------------------------- | ------------------- | ------ | ------------------------------- |
| 파일 읽기/쓰기/편집                     | ✅                  | ✅     | 동등                            |
| Bash 실행                               | ✅                  | ✅     | 동등                            |
| 웹 검색/페치                            | ✅                  | ✅     | 동등                            |
| 프로젝트 컨텍스트 (AGENTS.md/CLAUDE.md) | ✅                  | ✅     | CC 호환                         |
| 세션 저장/복원                          | ✅                  | ✅     | 동등                            |
| 권한 시스템                             | ✅                  | ✅     | 4가지 모드, CC 호환             |
| 훅 시스템                               | ✅                  | ✅     | CC 호환 구현 완료               |
| 멀티 프로바이더                         | ❌ (Anthropic only) | ✅     | Robota 우위                     |
| 플러그인 시스템                         | ✅                  | ✅     | marketplace는 미완              |
| 백그라운드 서브에이전트                 | ✅                  | ✅     | 구현됨                          |
| MCP 도구 지원                           | ✅                  | ✅     | `agent-tool-mcp` 패키지 존재    |
| 편집 롤백(/rewind)                      | ✅                  | ✅     | 구현됨                          |
| 컨텍스트 압축                           | ✅                  | ✅     | `/compact`                      |
| 메모리 관리                             | ✅                  | ✅     | `/memory`                       |
| 자동 업데이트                           | ✅                  | ⚠️     | 업데이트 체크만 (설치는 수동)   |
| IDE 통합                                | ✅                  | ❌     | 없음                            |
| 공식 문서 사이트                        | ✅                  | ⚠️     | 기술 문서만, 사용자 가이드 빈약 |

### Cursor/Windsurf와 비교

| 기능                 | Cursor/Windsurf | Robota             |
| -------------------- | --------------- | ------------------ |
| IDE GUI              | ✅              | ❌ (CLI only)      |
| 코드 자동완성        | ✅              | ❌                 |
| 인라인 편집          | ✅              | ⚠️ (Edit 도구)     |
| 프로젝트 색인/임베딩 | ✅              | ❌                 |
| 터미널 통합          | ✅              | ✅ (터미널이 주력) |
| 멀티 프로바이더      | ✅              | ✅                 |
| 오픈소스             | ❌              | ✅ (MIT)           |

**핵심 차별점**: Robota는 Claude Code 유사 CLI 도구로서 멀티 프로바이더 지원이 가장 큰 차별점. Cursor/Windsurf의 GUI 기능은 제공하지 않으며, 터미널 사용자와 자동화 파이프라인을 주요 타깃으로 해야 함.

---

## 권장 출시 전략

### 1. 포지셔닝 명확화

Robota는 "Claude Code의 멀티 프로바이더 오픈소스 대안"으로 포지셔닝하는 것이 가장 효과적이다. Claude Code는 Anthropic 모델만 지원하지만, Robota는 OpenAI 호환, DeepSeek, Qwen, 로컬 LLM(Gemma/LM Studio)까지 지원한다. 이 차별점을 README 상단과 docs 사이트에서 전면에 내세워야 한다.

### 2. 단계적 출시 권장

**현재 적합한 대상 (Beta 유지)**: 개발자, CLI 친화적 사용자, 멀티 프로바이더가 필요한 팀, 오픈소스 기여자

**RC/GA 전환 조건**:

- Node 22+ 설치율 상승 또는 하위 버전 지원 계획 결정
- 공개 docs 사이트에 Getting Started 가이드 추가
- macOS Terminal.app CJK 크래시 해결 또는 런타임 경고 추가
- apps/agent-server 기본 통합 테스트 통과

### 3. 문서화 우선 투자

현재 코드 품질과 기능 완성도는 높지만, 일반 사용자가 "처음 설치부터 AI와 대화"까지 도달하기 위한 가이드가 공개 사이트에 없다. VitePress 문서 사이트(`apps/docs`)에 다음을 추가하는 것이 출시 직전 가장 ROI가 높은 작업이다:

- 5분 Quick Start
- 프로바이더별 설정 가이드 (Anthropic, OpenAI, DeepSeek, Qwen, LM Studio)
- 주요 슬래시 커맨드 사용 예시
- 권한 시스템 설명

### 4. 커뮤니티 지원 채널 준비

GitHub Issues가 지원 채널이지만, beta 출시 시 이슈 템플릿(버그 리포트, 기능 요청)과 Contributing 가이드 추가를 권장한다.

### 5. 수익화 로드맵 공개

`packages/credits`와 `packages/auth`가 이미 컨트랙트로 존재하므로, 향후 유료 플랜(API 프록시 크레딧, 팀 기능 등)에 대한 로드맵을 공개하면 초기 사용자의 신뢰를 확보하는 데 도움이 된다.

---

## 종합 평가

Robota agent-cli는 **기술적 완성도는 높은 beta** 상태다. 아키텍처 규칙 준수(의존성 방향, React-free SDK, zero-dep core), 훅 시스템 CC 호환성, 멀티 프로바이더 지원 모두 검증이 완료되었고, 58개의 백로그가 완료 처리되어 있다.

출시를 막는 기술적 미완성 요소는 없지만, **사용자 경험 측면의 준비 부족**이 주요 리스크다:

- Node 22+ 진입장벽
- 일반 사용자 대상 공개 문서 빈약
- 수익화 플로우 미연결
- 앱 단 테스트 없음

P0 사항을 해결하고 P1 항목의 절반 이상을 완료한 후 **RC(Release Candidate) 선언**을 권장한다. 현재 beta.61 수준은 개발자 대상 early access로 적합하다.
