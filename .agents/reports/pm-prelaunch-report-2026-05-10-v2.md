# PM Pre-launch Report — Robota CLI (2026-05-10 v2)

**작성일**: 2026-05-10  
**이전 보고서**: `pm-prelaunch-report-2026-05-10.md` (v1)  
**조사 방법**: CLI 소스코드, 빌드 바이너리, 문서 콘텐츠, 플레이그라운드, 에이전트 서버 직접 읽기  
**범위**: 이전 보고서에서 다루지 않은 신규 관점만 포함

---

## Executive Summary

v1 보고서가 "기술적 완성도" 중심이었다면, 이번 v2 보고서는 **실제 사용자 경험 흐름**을 추적한 결과다. 핵심 발견은 세 가지다.

1. **CLI 진입점 UX 결함**: `--help` 플래그 미지원으로 새 사용자의 첫 탐색 경험이 막힌다. 불필요하게 TUI가 시작된다.
2. **Node.js 버전 표기 불일치**: 루트 README는 "18+", Getting Started는 "18+(권장 22)", CLI는 실제로 22+ 강제 — 문서 3개소에서 다른 메시지를 제공한다.
3. **Web Playground 실사용 불가**: 프로덕션 서버 URL 없이 `ws://localhost:3001/ws`로 하드코딩되어 공개 사이트에서 실제로 동작하지 않는다.

기술적 기반은 탄탄하다. 바이너리 레벨 Node.js 버전 체크, macOS Terminal.app 조기 경고, 프로바이더 정의 기반 대화형 설정, 업데이트 체크 캐시까지 잘 구현되어 있다. 사용자 경험 연결고리 몇 곳을 메우면 출시 품질에 도달할 수 있다.

---

## Launch Readiness Scorecard

| Category           | Score | Notes                                                                                 |
| ------------------ | ----- | ------------------------------------------------------------------------------------- |
| Core functionality | 8/10  | 8개 도구, 19개 슬래시 커맨드, 멀티프로바이더 — `--system-prompt` 미동작 1건 제외 탄탄 |
| Onboarding         | 5/10  | `--help` 없음, Node.js 버전 표기 3중 불일치, 단 첫 실행 설정 흐름은 우수              |
| Documentation      | 6/10  | CLI/SDK 가이드 충실하나 docs 사이트(.temp 빌드)에 실제 전달 확인 필요, 버전 불일치    |
| Stability          | 7/10  | 바이너리 레벨 오류 처리 견고, IME 크래시 억제 로직 존재, apps 테스트는 최소 수준      |
| Multi-provider     | 8/10  | 6개 채팅 프로바이더 + 1개 비디오(ByteDance) 지원, CLI/서버 동일 provider 사용 확인    |

---

## Critical Gaps (출시 차단 수준)

### PM-C-001: `--help` 플래그 미지원 — 첫 탐색 경험 차단

**사용자 영향**: 개발자가 CLI를 설치한 후 가장 먼저 시도하는 것은 `robota --help`다. 현재 이 명령을 실행하면 TUI가 열리거나 오류 메시지가 출력되는 대신 아무 안내 없이 인터랙티브 세션이 시작된다.

**현재 동작** (`bin/robota.cjs` 기반 실제 확인):

```
Unknown option '--help'. To specify a positional argument starting with a '-',
place it at the end of the command after '--', as in '-- "--help"'
```

Node.js `parseArgs()`의 기본 오류 메시지가 그대로 사용자에게 노출된다. 사용법 안내가 전혀 없다.

**필요한 변경**:

- `cli-args.ts`에 `--help` / `-h` 옵션 추가
- CLI 플래그 전체 목록과 간단한 사용 예시를 출력하는 `printHelp()` 함수 구현
- `--version`처럼 출력 후 즉시 종료

**Claude Code 비교**: `claude --help`는 전체 플래그 목록과 예시를 출력한다.

---

### PM-C-002: Node.js 버전 요구사항 3중 불일치

**사용자 영향**: 사용자가 설치 전 요구사항을 확인할 때 세 문서에서 다른 정보를 받는다.

**현재 상태 (실제 파일 확인)**:

| 문서                                                         | 표기                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| `/README.md` (루트, GitHub 진입점)                           | "Node.js 18+ required"                             |
| `/content/getting-started/README.md` (docs 사이트 첫 페이지) | "Node.js: 18.0.0 or higher (recommended: 22.14.0)" |
| `/packages/agent-cli/README.md`                              | "Node.js **22 or higher** is required"             |
| `bin/robota.cjs` (실제 강제 버전)                            | `>= 22` — 22 미만이면 즉시 `process.exit(1)`       |

GitHub에서 프로젝트를 처음 발견한 사용자는 "18+ required"를 보고 Node 18/20 환경에서 설치를 시도한다. 설치 후 실행하면 `Robota requires Node.js 22 or higher` 오류가 나온다.

**필요한 변경**:

- 루트 `README.md`: "Node.js 18+ required" → "Node.js **22 or higher** required"
- `content/getting-started/README.md`: Prerequisites 섹션을 `>= 22` 로 통일 (SDK 사용자는 18+일 수 있으므로 CLI와 SDK 구분 명시)

---

### PM-C-003: Web Playground 공개 사이트에서 실제 동작 불가

**사용자 영향**: robota.io에서 Playground를 클릭한 사용자가 에이전트와 대화를 시도하면 응답을 받을 수 없다. 제품 신뢰도에 치명적이다.

**현재 상태** (코드 직접 확인):

```typescript
// packages/agent-playground/src/playground/components/PlaygroundApp.tsx
export function PlaygroundApp(props: { defaultServerUrl?: string }): React.ReactElement {
  return (
    <PlaygroundProvider defaultServerUrl={props.defaultServerUrl ?? 'ws://localhost:3001/ws'}>
```

`apps/agent-web/src/app/playground/page.tsx`에서 `PlaygroundApp`을 props 없이 호출:

```typescript
export default function PlaygroundPage() {
  return <PlaygroundApp />;  // defaultServerUrl 전달 없음 → localhost:3001 폴백
}
```

`apps/agent-web/.env.example`에도 playground 서버 URL 관련 환경변수가 없다. 즉, 공개 배포 시 서버 연결 설정 경로가 존재하지 않는다.

**PlaygroundDemo** (`/playground/demo`)는 LLM 호출 없이 정적 시각화만 보여주므로 동작하지만, 이것이 "AI와 대화할 수 있다"는 기대를 충족하지 못한다.

**필요한 변경**:

- `NEXT_PUBLIC_PLAYGROUND_WS_URL` 환경변수를 추가하고 `PlaygroundApp`에 전달
- 또는: 서버가 없으면 "서버 연결 필요" 안내 UI 표시
- 또는: `/playground/demo` 를 전면에 내세우고 실제 AI 대화는 "self-hosted" 기능으로 명시

---

## Important Gaps (출시 전 개선 권장)

### PM-I-001: `--system-prompt` 플래그 미동작 — 문서화된 기능이 경고와 함께 무시됨

**사용자 영향**: README와 CLI 플래그 목록에 `--system-prompt <text>`가 문서화되어 있으나 실제로는 경고를 출력하고 무시한다.

**현재 상태** (`cli.ts` 라인 351-353):

```typescript
// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
if (args.systemPrompt) {
  process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
}
```

**필요한 변경**:

- 구현 완료까지 `--system-prompt`를 CLI 플래그에서 제거하거나 README에서 "(미구현)" 표시
- 또는: `IInteractiveSessionStandardOptions`에 `systemPrompt` 필드를 추가하여 완성

---

### PM-I-002: `agent-command-mode` 패키지가 CLI에 등록되지 않음 — orphan 패키지

**사용자 영향**: `/mode` 커맨드가 패키지(`@robota-sdk/agent-command-mode`)로 구현되어 있으나 `createDefaultCliCommandModules()`에 등록되지 않아 사용자가 접근할 수 없다.

**현재 상태** (`cli.ts` `createDefaultCliCommandModules` 확인):
`createPermissionsCommandModule`은 포함되어 있으나 `createModeCommandModule`은 없다. `/mode` 커맨드는 `getHistory`, `clearHistory` 같은 기능을 담당하는 것으로 보이지만 실제 CLI에서 접근 불가.

**필요한 변경**:

- `/mode` 커맨드가 실제로 필요한지 검토
- 필요하다면 `createDefaultCliCommandModules`에 추가
- 불필요하다면 패키지를 deprecated 처리 또는 제거 (현재 `backlog: none`)

---

### PM-I-003: Getting Started 문서의 Node.js 버전이 SDK와 CLI를 혼용

**사용자 영향**: `content/getting-started/README.md`의 Prerequisites 섹션이 SDK 사용자(18+)와 CLI 사용자(22+ 필수)를 구분하지 않아 혼란을 준다.

**현재 상태**:

```markdown
## Prerequisites

- **Node.js**: 18.0.0 or higher (recommended: 22.14.0)
```

바로 아래 "System Requirements" 박스에서는:

```markdown
- **Node.js 22 or higher** — check with `node --version`
```

같은 문서 내에서도 두 개의 다른 버전이 명시된다.

**필요한 변경**:

- CLI 섹션과 SDK 섹션의 Node.js 요구사항을 명시적으로 분리
- CLI: "Node.js 22 or higher required (enforced at runtime)"
- SDK: "Node.js 18 or higher (22 recommended)"

---

### PM-I-004: GitHub 이슈/PR 템플릿 없음 — 커뮤니티 지원 준비 미완

**사용자 영향**: 베타 출시 후 버그 리포트나 기능 요청이 들어올 때 정보 수집 구조가 없다. 노이즈 이슈가 많아지고 대응 비용이 높아진다.

**현재 상태**: `.github/` 디렉토리에 `CODEOWNERS`, `workflows/`, `lighthouse/`만 존재. `ISSUE_TEMPLATE/`과 `PULL_REQUEST_TEMPLATE` 없음.

`CONTRIBUTING.md`는 존재하지만 이슈 템플릿 없이는 실효성 낮음.

**필요한 변경**:

- `.github/ISSUE_TEMPLATE/bug_report.md`: Node.js 버전, OS, 터미널, 프로바이더, 오류 메시지 필드 포함
- `.github/ISSUE_TEMPLATE/feature_request.md`: 기본 템플릿
- (선택) `.github/PULL_REQUEST_TEMPLATE.md`

---

### PM-I-005: ByteDance 프로바이더가 CLI에서 숨겨진 기능

**사용자 영향**: `@robota-sdk/agent-provider-bytedance`가 v3.0.0-beta.61로 배포되어 있으나 이것은 채팅 프로바이더가 아닌 **비디오 생성 프로바이더** (`IVideoGenerationProvider` 구현)다. CLI 기본 프로바이더에 포함되지 않고 문서에서도 설명이 없다. 사용자가 발견하면 "비디오 생성 AI"를 설치했다고 오해할 수 있다.

**현재 상태**: ByteDance 프로바이더 설명: "ByteDance/BytePlus media integration for Robota SDK - Seedance video generation provider support". CLI 기본 provider 목록에 없음. Getting Started 문서의 "Supported Providers" 표에도 없음.

**필요한 변경**:

- Getting Started 문서에서 "지원 프로바이더" 표 분리: 채팅 프로바이더 / 미디어 생성 프로바이더
- ByteDance(Seedance)가 비디오 생성용임을 명확히 문서화

---

## Nice-to-have (출시 후 로드맵)

### PM-N-001: `robota --help` 이후 인터랙티브 온보딩 플로우

현재 첫 실행 시 provider 선택 → API 키 입력 → 언어 선택으로 이어지는 설정 흐름이 이미 잘 구현되어 있다. 여기에 "처음이세요? 빠른 시작 가이드를 보려면 `/help`를 입력하세요" 같은 안내를 추가하면 첫 성공 경험까지의 경로가 더 명확해진다.

### PM-N-002: `robota --version` 에 beta 상태 명시

현재 `robota --version` 출력: `robota 3.0.0-beta.61`

여기에 "This is a beta release. Report issues at https://github.com/woojubb/robota/issues" 한 줄을 추가하면 beta 상태를 명시적으로 전달한다.

### PM-N-003: Playground Demo 개선 — 정적 시각화 → 인터랙티브 시뮬레이션

현재 `/playground/demo`는 하드코딩된 실행 트리 시각화만 보여준다. LLM 없이도 "에이전트가 실제로 작동하는 것처럼" 보여주는 시뮬레이션 모드를 추가하면 API 키 없는 첫 방문자의 인상을 크게 개선할 수 있다.

### PM-N-004: 입력 히스토리 탐색 문서화

`InputArea.tsx`에서 `navigatePromptHistory`가 구현되어 있어 위 화살표로 이전 입력을 탐색할 수 있다. 그러나 README나 키보드 단축키 표에 이 기능이 문서화되어 있지 않다. 소소하지만 개발자가 좋아하는 기능이다.

### PM-N-005: `/mode` 커맨드 재검토

`@robota-sdk/agent-command-mode` 패키지가 구현되어 있으나 CLI에 등록되지 않은 orphan 상태다. 이 커맨드는 `/permissions`의 기능과 상당 부분 겹친다. 배포 전에 역할을 명확히 하거나 제거하는 결정이 필요하다.

---

## Competitor Feature Comparison (신규 관점 보완)

이전 보고서의 기능 비교표에서 다루지 않은 **온보딩 및 첫 실행 경험** 관점 추가.

| 온보딩 경험                          | Claude Code                | Robota                            | 비고                             |
| ------------------------------------ | -------------------------- | --------------------------------- | -------------------------------- |
| `--help` 플래그                      | ✅ 전체 플래그 목록        | ❌ 오류 메시지 출력               | 차이 있음                        |
| 첫 실행 설정 마법사                  | ✅                         | ✅                                | 동등                             |
| Node.js 버전 체크 (친절한 오류)      | ✅                         | ✅                                | Robota가 더 상세 (nvm 명령 포함) |
| macOS Terminal 경고                  | ❌ (첫 실행 후 알 수 있음) | ✅ (바이너리 레벨 즉시 경고)      | Robota 우위                      |
| npm 업데이트 체크                    | ✅                         | ✅ (캐시 기반, 하루 1회)          | 동등                             |
| 웹 플레이그라운드 (API 키 없이 체험) | ❌                         | ⚠️ Demo만 가능, 실제 AI 대화 불가 | 모두 취약                        |
| 문서 일관성 (버전 표기)              | ✅                         | ❌ 3개소 불일치                   | 개선 필요                        |
| GitHub 이슈 템플릿                   | ✅                         | ❌ 없음                           | 출시 전 추가 권장                |

---

## 종합 평가

v1 보고서와 달리 이번 조사는 **사용자가 실제로 제품에 닿는 순간**을 추적했다. 코드와 문서를 상호 대조하여 확인한 실제 불일치는 v1이 발견한 "큰 그림" 갭보다 작지만, 사용자 신뢰에 직접적으로 영향을 미치는 표면 결함들이다.

**출시를 차단할 수준의 변경**은 3건이며, 모두 코드 수정보다는 문서/설정 수정 수준이다:

1. `--help` 플래그 추가 (구현 난이도: 낮음, 영향도: 높음)
2. Node.js 버전 표기 통일 (문서 수정, 30분 이내)
3. Playground 서버 URL 환경변수화 또는 "연결 필요" 안내 UI

v2 보고서 기준 출시 준비도: **RC 전환을 위한 마지막 표면 정리 단계**. 3건의 Critical gap과 2건의 Important gap을 해결하면 사용자에게 일관된 첫인상을 제공할 수 있다.
