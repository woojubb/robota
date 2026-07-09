# Robota CLI 제품 완성도 검토 보고서

> 작성일: 2026-05-23  
> 검토자: 시니어 프로덕트 매니저 관점 (독립 평가)  
> 검토 버전: `3.0.0-beta.67`

---

## 요약 (전체 완성도 점수: 6.5/10)

Robota CLI는 기술적 기반이 탄탄하고 아키텍처 설계가 우수하다. 21개의 슬래시 커맨드, 멀티 프로바이더 지원, 플러그인 시스템, 세션 관리, 백그라운드 에이전트 등 고급 기능이 이미 구현되어 있으며, 온보딩 문서의 구조와 CLI 레퍼런스 문서의 완성도도 높다. 그러나 **베타 버전 상태가 사용자에게 명확히 전달되지 않고**, 경쟁사 비교 테이블의 일부 주장이 검증 없이 게시되고 있으며, 엔터프라이즈 기능(팀 정책, 중앙 로깅, SSO)이 부재하다. Node.js 22+ 강제 요구 사항은 실사용 환경에서 이탈 유발 요인이 될 수 있으며, macOS Terminal.app CJK 크래시 같은 알려진 버그가 출시 전 해결되지 않은 점도 주요 리스크다. 핵심 기능 구현과 문서 품질의 격차가 작아 출시 준비에 가깝지만, 몇 가지 사용자 이탈 유발 요소를 제거해야 상업적 출시가 가능하다.

---

## 항목별 상세 평가

### 1. 온보딩 경험

**현황**

- `getting-started/README.md`는 4가지 사용자 유형별 진입 경로를 제공한다 ("코딩 어시스턴트 원함", "에이전트 빌드 원함", "API 키 없음" 등).
- `npx @robota-sdk/agent-cli` 한 줄로 설치 없이 실행 가능하며, 첫 실행 시 프로바이더 선택 → API 키 입력 플로우가 구현되어 있다.
- LM Studio 무료 로컬 모델 경로가 온보딩 문서 최상단에 안내되어 있다.
- 문서 도입부에서 "2분"을 약속하지만, 실제로는 Node.js 22+ 확인 → 설치 → API 키 발급 → 프로바이더 설정 순서가 필요하다.

**갭**

- `getting-started/README.md` 코드 샘플에 `@robota-sdk/agent-provider-anthropic`처럼 존재하지 않을 수 있는 서브패스 임포트가 사용된다. 실제 패키지 경로와 일치 여부를 검증해야 한다.
- `InteractiveSession` 사용 예제(#4)에서 `@robota-sdk/agent-framework`를 import하지만, 이 패키지가 공개 패키지인지 확인이 필요하다.
- 첫 실행 프롬프트가 텍스트 기반(숫자 선택)으로 구현되어 있어, TUI 기대를 가지고 들어온 사용자가 낯설어할 수 있다.
- Windows 지원이 "WSL 권장"으로 명시되어 있으나 네이티브 Windows 지원 여부가 불명확하다.

**개선 방향**

- 온보딩 문서의 "2분" 약속을 실질 소요 시간 기준으로 수정하거나, Gemini 무료 키 경로를 기준으로 테스트해 검증한다.
- Windows 네이티브 지원 로드맵 또는 명확한 미지원 선언이 필요하다.

---

### 2. 명령어 발견 가능성

**현황**

- `/help` 커맨드가 구현되어 있으며 `formatCommandHelpMessage(context)` 기반으로 동적으로 생성된다.
- 슬래시 자동완성 팝업이 구현되어 있고 (Arrow키 탐색, Tab = 삽입, Enter = 실행), 21개 빌트인 커맨드가 모두 등록되어 있다.
- 플러그인 제공 커맨드는 `/plugin-name:command` 형식으로 구분된다.

**갭**

- `robota --help` 출력에는 슬래시 커맨드 목록이 없다 — CLI 플래그 도움말과 TUI 내 슬래시 커맨드 도움말이 분리되어 있어 처음 사용자가 `/help`를 알기 전까지 커맨드를 발견하기 어렵다.
- 자동완성 팝업이 열려 있을 때 Esc 동작(닫기)과 실행 중단 Esc가 동일 키를 사용한다 — 문서에 명시되어 있으나 UX 충돌 가능성이 있다.
- 에러 메시지에서 관련 커맨드를 추천하는 기능이 없다 (예: 모델 전환 실패 시 `/model` 커맨드 추천).

**개선 방향**

- `robota --help` 출력 하단에 "TUI에서 `/help`를 입력하면 모든 커맨드를 볼 수 있습니다" 안내를 추가한다.
- 자동완성과 세션 중단이 같은 Esc를 공유하는 문제를 Esc의 컨텍스트 우선순위 문서화 또는 변경으로 해결한다.

---

### 3. 경쟁사 대비 기능 격차

**현황**

`apps/www/src/app/compare/page.tsx`의 비교 테이블 기준:

| 항목                | Robota 주장 | 검증 결과                                                     |
| ------------------- | ----------- | ------------------------------------------------------------- |
| 멀티 프로바이더     | ✓           | 확인됨 (Anthropic, OpenAI, DeepSeek, Gemini, Qwen, LM Studio) |
| BYOK                | ✓           | 확인됨                                                        |
| 로컬 모델           | ✓           | 확인됨 (LM Studio 경로 구현)                                  |
| 임베더블 SDK        | ✓           | 확인됨 (`@robota-sdk/agent-framework`)                        |
| 세션 지속/재개      | ✓           | 확인됨                                                        |
| 백그라운드 에이전트 | ✓           | 확인됨                                                        |
| 비용 비교표         | 주석 처리됨 | 미완성 — 비용 섹션이 코드에서 comment-out 상태                |

**갭 (Claude Code, Cursor, Aider 대비 누락 기능)**

- **인라인 diff 편집**: Cursor/Copilot처럼 에디터 내 인라인 수정 제안이 없다 — CLI 특성상 이는 수용 가능하나, VS Code 확장 없이 에디터 통합이 없다.
- **IDE 통합**: Claude Code는 VS Code 확장이 있고 Cursor는 IDE 자체이나 Robota는 순수 CLI — VS Code 확장 로드맵 부재.
- **Tab 자동완성 (코드 인라인)**: GitHub Copilot/Cursor의 인라인 코드 완성 기능 없음 — 이는 다른 제품 카테고리이므로 정당하나 비교 페이지에 명시가 없다.
- **Git 통합**: Aider는 git 커밋 자동화가 강점인데, Robota는 Bash 툴로 git을 간접 호출하는 방식 — 직접 git 통합 커맨드 없음.
- **비용 계산기**: 비교 페이지에서 cost calculator 링크가 주석 처리되어 있다 (`/tools/cost-calculator` 라우트 미완성).

**개선 방향**

- 비용 비교 섹션을 주석 해제하거나 완성 전까지 비교 페이지에서 제거한다.
- "Terminal-first" 포지셔닝을 명확히 하여 IDE 통합 부재를 약점이 아닌 설계 선택으로 전달한다.

---

### 4. 프로바이더 설정 경험

**현황**

- 첫 실행 시 3단계 온보딩이 구현되어 있다: (1) API 키 보유 여부 선택, (2) Gemini 무료 키 안내, (3) LM Studio 로컬 모델 안내.
- `provider-setup-flow.ts`에서 프로바이더 정의 기반으로 동적으로 설정 단계를 생성한다 — 하드코딩 없이 확장 가능한 구조.
- `/provider` TUI 커맨드에서 switch/edit/test/duplicate/delete 전체 프로필 관리가 가능하다.
- `$ENV:DASHSCOPE_API_KEY` 같은 환경 변수 참조를 설정 파일에 직접 쓸 수 있다.
- `--configure-provider`, `--api-key`, `--api-key-env`, `--base-url` 등 비대화형 설정 플래그가 완비되어 있다.

**갭**

- Qwen(DashScope), Gemma, OpenAI-compatible 프로바이더가 CLI README에는 있으나 `packages/agent-cli/README.md`의 환경 변수 표에는 `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY` 세 개만 나열되어 있다 — `OPENAI_API_KEY`, `GEMINI_API_KEY` 등이 누락되어 있다.
- 프로바이더 전환 후 CLI가 재시작된다 (`/model` 변경 시 재시작 확인 프롬프트가 표시됨) — 세션 히스토리를 잃지 않고 전환할 수 없다.
- 여러 프로젝트에서 공유 프로바이더 프로필을 관리하는 팀 수준의 설정 공유 메커니즘이 없다.

**개선 방향**

- README 환경 변수 표를 지원하는 모든 프로바이더로 확장한다.
- `/model` 전환 시 재시작 없이 동적 전환이 가능한지 검토한다 (현재 설계 제약인지 아키텍처 한계인지 확인 필요).

---

### 5. 문서-기능 일치도

**현황**

- CLI 레퍼런스 문서(`content/guide/cli.md`)는 21개 슬래시 커맨드를 정확히 나열하고 있으며, 실제 구현(`default-command-modules.ts`)의 커맨드 수와 일치한다.
- 출력 포맷 3종(text/json/stream-json), stdin 파이프, 세션 관리 플래그, 권한 모드 4종이 문서와 구현 모두에서 확인된다.
- `/statusline`, `/rename`, `/validate-session` 같은 특수 커맨드도 문서에 정확히 기재되어 있다.

**갭**

- `getting-started/README.md` 예제 #4에서 `@robota-sdk/agent-framework` 패키지의 `InteractiveSession`을 직접 사용하는 예제가 있는데, 이 패키지가 npm에 공개되어 있고 사용자가 직접 사용할 수 있는지 확인이 필요하다.
- `getting-started/README.md`의 예제 코드에서 모델 ID로 `claude-sonnet-4-6`을 사용하지만, CLI 레퍼런스에서는 `claude-opus-4-6`도 언급된다 — 모델 ID 일관성 검토 필요.
- `content/guide/cli.md`에서 `/settings` 커맨드를 언급하지 않지만 `default-command-modules.ts`에는 `createSettingsCommandModule()`이 포함되어 있다 — 문서 누락.

**개선 방향**

- `/settings` 커맨드를 CLI 레퍼런스 문서의 슬래시 커맨드 표에 추가한다.
- `@robota-sdk/agent-framework` 패키지의 공개 API 범위를 문서화한다.

---

### 6. 에러 메시지 품질

**현황**

- `cli-args.ts`의 인자 검증 에러 메시지가 구체적이다: `Invalid --output-format "xyz". Valid: text | json | stream-json`
- 프로바이더 미설정 시 `formatMissingProviderConfigMessage()`가 지원 프로바이더 목록과 `--configure-provider` 예시를 함께 출력한다.
- 플러그인 에러가 `Plugin error: <message>` 형식으로 명시적으로 래핑된다.
- 알 수 없는 플러그인 서브커맨드에 `Unknown plugin subcommand: <name>` 메시지와 함께 사용법이 출력된다.

**갭**

- `process.exit(1)` 호출 시 구체적인 에러 컨텍스트가 항상 출력되는지 확인이 필요하다 (`cli.ts`의 `parseArgsOrExit` 참조).
- API 키 인증 실패 시 (잘못된 키, 만료된 키) 에러 메시지가 프로바이더별로 다를 수 있는데, 이를 표준화한 안내가 문서에 없다.
- 스트리밍 중 네트워크 단절 시 사용자에게 표시되는 메시지가 문서화되어 있지 않다.

**개선 방향**

- 프로바이더별 일반 에러 코드(인증 실패, 할당량 초과, 네트워크 오류)에 대한 사용자 친화적 메시지 레지스트리를 추가한다.
- troubleshooting 섹션에 "API 키 오류" 시나리오별 해결 방법을 추가한다.

---

### 7. 파워 유저 기능

**현황**

- `-p` 플래그와 3종 출력 포맷(text/json/stream-json)으로 스크립팅 및 파이프라인 통합이 가능하다.
- stdin 파이프가 지원된다: `git diff | robota -p "Review this diff"`
- `--max-turns`, `--permission-mode`, `--append-system-prompt`, `--json-schema` 등 고급 플래그가 완비되어 있다.
- `--dry-run` 플래그로 파일 수정 없이 계획만 확인할 수 있다.
- `--no-session-persistence`로 세션 저장을 비활성화할 수 있다.
- `--allowed-tools`로 특정 턴에서 사용 가능한 도구를 제한할 수 있다.
- `robota init` 서브커맨드로 프로젝트 초기화가 가능하다.

**갭**

- `--task-file` 플래그가 `cli-args.ts`에 정의되어 있으나 `--help` 출력과 CLI 레퍼런스 문서에 설명이 없다.
- `--bare`, `--format`, `--summary`, `--source` 플래그가 `cli-args.ts`에 정의되어 있으나 `--help`나 문서에 없다 — 내부 플래그인지, 미완성 기능인지 불명확하다.
- `--fork-session`이 `--help` 출력에 없다.
- CI/CD 파이프라인 통합 예제 문서가 없다 (GitHub Actions에서 `robota -p` 사용 예제 등).

**개선 방향**

- `--help` 출력과 문서에서 의도적으로 숨긴 플래그(내부용)와 공개 플래그를 명확히 분리한다.
- CI/CD 통합 섹션을 문서에 추가한다.

---

### 8. 플러그인 생태계

**현황**

- `/plugin` 커맨드 및 TUI 메뉴가 완전히 구현되어 있다 (install/uninstall/enable/disable/marketplace).
- 마켓플레이스 소스 관리(add/remove/update/list)가 구현되어 있다.
- 플러그인은 `~/.robota/plugins/` (유저 스코프)와 `.robota/plugins/` (프로젝트 스코프)를 지원한다.
- 공식 플러그인으로 `@robota-sdk/plugin-github`, `@robota-sdk/plugin-slack`, `@robota-sdk/plugin-jira`, `@robota-sdk/plugin-linear`, `@robota-sdk/plugin-notion`이 monorepo에 존재한다.

**갭**

- 공식 플러그인들의 README가 없거나 비어있다 — 플러그인 설치 방법을 알 수 없다.
- 공개 마켓플레이스 URL이 문서에 없다 — 마켓플레이스 인프라가 실제로 운영 중인지 불명확하다.
- `/plugin install <name>@<marketplace>` 형식에서 사용 가능한 마켓플레이스 이름을 어디서 찾는지 안내가 없다.
- 플러그인 개발 가이드(`content/guide/plugins.md`)가 가이드 목차에는 있으나 실제 파일이 존재하는지 확인이 필요하다.

**개선 방향**

- 플러그인 마켓플레이스 URL 또는 공식 플러그인 목록 페이지를 문서에 추가한다.
- 공식 5개 플러그인의 설치 및 사용 방법을 각 README에 추가한다.
- 플러그인 개발 가이드가 존재하는지 확인하고, 없다면 최소한의 샘플과 함께 작성한다.

---

### 9. 엔터프라이즈 준비도

**현황**

- `@robota-sdk/agent-plugin/src/logging/` 경로에 로깅 플러그인이 구현되어 있다 (ILogStorage, ILogFormatter 인터페이스 포함).
- 세션 로그가 `.robota/logs/{sessionId}.jsonl` JSONL 형식으로 저장된다.
- 권한 모드 4종과 allow/deny 패턴 설정이 프로젝트 레벨에서 `.robota/settings.json`으로 관리 가능하다.
- 비대화형 설정 플래그로 CI/CD 환경에서 무인 구성이 가능하다.

**갭**

- 팀 공유 설정 메커니즘이 없다 — `.robota/settings.json`은 개인 또는 프로젝트 레벨이며, 조직 레벨 정책 레이어가 없다.
- SSO/SAML 통합이 없다.
- 중앙 감사 로그(centralized audit log) 또는 원격 로그 수집 기능이 없다.
- 역할 기반 접근 제어(RBAC)가 없다 — 누가 어떤 툴을 사용할 수 있는지 제어 불가.
- 데이터 주권(어떤 데이터가 AI 프로바이더에게 전송되는지) 관련 문서가 없다.
- 프록시 서버 설정 지원 여부가 문서화되어 있지 않다.

**개선 방향**

- 단기: 데이터 흐름 문서(어떤 데이터가 외부로 전송되는지)를 보안 페이지에 추가한다.
- 단기: 로컬 모델 사용 시 데이터가 외부로 나가지 않음을 명확히 마케팅 포인트로 강조한다.
- 장기: 조직 레벨 설정 레이어(`~/.robota/org-settings.json` 또는 환경 변수 기반) 설계.

---

### 10. 출시 준비도

**현황**

- `@robota-sdk/agent-cli` npm 패키지는 `3.0.0-beta.67` 버전으로 실제 배포 중이다.
- `packages/agent-cli/README.md`가 상세하게 작성되어 있다 — 설치, 사용법, 설정, 권한, 세션 관리, 아키텍처 다이어그램 포함.
- `CHANGELOG.md`가 `Keep a Changelog` 형식을 따르며 `3.0.0` 기준으로 작성되어 있다.
- MIT 라이선스가 명시되어 있다.
- `robota.io` 도메인이 있으며 비교 페이지 등 마케팅 페이지가 존재한다.

**갭**

- **버전 상태 불일치**: `3.0.0-beta.67`이지만 문서와 마케팅 페이지 어디에도 "베타 소프트웨어"임이 명시되어 있지 않다 — 사용자가 프로덕션 안정성을 기대할 수 있다.
- **Node.js 22+ 요구 사항**: npm 생태계 기준으로 매우 높은 버전 요구 — Node.js 18 LTS, 20 LTS 사용자가 배제된다 (실제로 SDK는 18+를 지원한다고 명시).
- **비용 비교 테이블 미완성**: `compare/page.tsx`에서 비용 섹션이 주석 처리된 채 게시되어 있다.
- **changelogs가 패키지별로 분산**: `packages/agent-cli/CHANGELOG.md`가 없고 루트 `CHANGELOG.md`만 있다 — npm 패키지 페이지에서 패키지별 변경 이력을 볼 수 없다.
- **macOS Terminal.app CJK 크래시**: 알려진 버그가 출시 전 해결되지 않았으며, 특히 한국/일본 시장 타겟 시 심각한 이탈 요인이다.

**개선 방향**

- npm 태그를 `latest`와 `beta`로 명확히 분리하거나, 베타 상태를 문서와 README에 명시한다.
- CLI Node.js 요구 사항을 20 LTS로 낮추거나, 22 요구의 기술적 이유를 문서화한다.

---

## 즉시 해결 필요 (사용자 이탈 유발)

1. **Node.js 22+ 강제 요구**: npm 생태계에서 Node.js 18 LTS, 20 LTS 사용자가 `npx @robota-sdk/agent-cli` 실행 시 즉시 오류를 맞는다. `package.json`의 `engines.node`가 `>=22.0.0`으로 설정되어 있어, Node.js 20 LTS 사용자(가장 일반적인 환경)가 모두 차단된다. SDK는 18+를 지원한다고 명시되어 있어 CLI와 SDK 간 요구 사항이 불일치한다.

2. **macOS Terminal.app CJK IME 크래시**: 알려진 버그로 한국어/일본어/중국어 사용자의 기본 터미널에서 크래시가 발생한다. 한국 개발자 시장을 타겟팅하는 제품에서 한국어 입력이 크래시를 유발하는 것은 치명적이다. iTerm2 권장은 회피책이지 해결책이 아니다.

3. **베타 상태 미명시**: `robota.io` 마케팅 페이지와 문서 어디에도 "이 소프트웨어는 베타 버전입니다"라는 안내가 없다. 사용자가 프로덕션 안정성을 기대하고 도입했다가 이탈할 수 있다.

4. **플러그인 마켓플레이스 실체 불명확**: `/plugin install <name>@<marketplace>`라는 커맨드가 존재하지만, 사용 가능한 마켓플레이스와 플러그인이 어디에도 문서화되어 있지 않다. 기능을 발견한 사용자가 사용하려 할 때 막힌다.

---

## 단기 개선 권고 (출시 전 필수)

1. **환경 변수 표 완성**: `packages/agent-cli/README.md`의 환경 변수 표에 `OPENAI_API_KEY`, `GEMINI_API_KEY` 등 누락된 프로바이더를 추가한다.

2. **숨겨진 플래그 정리**: `--task-file`, `--bare`, `--format`, `--summary`, `--source`, `--fork-session` 등 `cli-args.ts`에 정의되어 있으나 `--help`와 문서에 없는 플래그를 정리한다. 내부 플래그라면 파싱 로직에서 제거하거나 명시적으로 내부용임을 주석으로 표시한다.

3. **`/settings` 커맨드 문서화**: `default-command-modules.ts`에 `createSettingsCommandModule()`이 있으나 CLI 레퍼런스 슬래시 커맨드 표에 없다. 추가한다.

4. **비용 비교 페이지 완성 또는 제거**: `compare/page.tsx`의 주석 처리된 비용 섹션을 완성하거나 현재 버전에서 제거한다. 미완성 주석이 코드에 남아있는 채 게시하는 것은 비전문적으로 보인다.

5. **공식 플러그인 README 작성**: `plugin-github`, `plugin-slack`, `plugin-jira`, `plugin-linear`, `plugin-notion` 각 패키지에 최소한의 설치 방법과 사용 예시 README를 추가한다.

6. **CI/CD 통합 예제 문서 추가**: `robota -p "..."` 헤드리스 모드를 GitHub Actions에서 사용하는 예제를 가이드 또는 README에 추가한다. 이는 파워 유저 획득과 바이럴에 효과적이다.

7. **프로바이더 전환 재시작 동작 문서화**: `/model` 변경 시 CLI가 재시작된다는 사실을 사용자 스스로 발견하기 전에 문서에 명시한다.

---

## 장기 개선 권고 (v2 수준)

1. **엔터프라이즈 설정 레이어**: 조직 레벨 `.robota/org-policy.json` 또는 환경 변수 기반 정책 레이어. 팀 내 모든 개발자에게 동일한 프로바이더 설정, 권한 정책, 금지 커맨드를 강제할 수 있다.

2. **VS Code 확장**: 순수 CLI를 넘어 에디터 사이드바 에이전트로 확장한다. Claude Code와 Cline이 점유하는 에디터 통합 시장을 공략하는 경쟁력 있는 포지셔닝이 될 수 있다.

3. **Git 커밋 자동화**: Aider처럼 에이전트가 수행한 변경사항을 자동으로 git commit하는 옵션. 현재는 Bash 툴로 git을 간접 호출해야 한다.

4. **프로바이더 핫 스왑**: `/model` 변경 시 세션 재시작 없이 동적 전환이 가능하도록 아키텍처를 개선한다. 장기 세션에서 모델 전환이 세션 히스토리를 보존하지 않는 현재 동작은 파워 유저에게 불편하다.

5. **비용 추적 및 알림**: 세션별/프로젝트별 API 비용 누적 추적 및 임계값 알림. BYOK 사용자의 비용 가시성이 구독 기반 경쟁사 대비 강점이 될 수 있다.

6. **원격 세션 공유**: 팀원과 세션 히스토리를 공유하거나 페어 프로그래밍 모드 지원.

7. **MCP 서버 브라우저**: `@robota-sdk/agent-tool-mcp` 패키지가 이미 존재하는데, TUI 내에서 MCP 서버를 검색하고 설치하는 경험을 추가한다.

---

_이 보고서는 실제 소스 파일 분석에 기반하며, 런타임 검증을 포함하지 않는다. 일부 평가는 추가 런타임 테스트로 검증이 필요하다._
