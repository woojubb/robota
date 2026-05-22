# 시니어 웹 기획자 검토: robota CLI 사용성·상품성 분석

> 작성일: 2026-05-23
> 작성자: 시니어 웹서비스 기획자 (개발자 도구 SaaS 기획 전문)
> 분석 대상: `@robota-sdk/agent-cli` v3.0.0-beta.67
> 분석 관점: 사용성, 상품성, 기능 발견성, 경쟁 차별화, 국제화
> 참고: 기존 분석(comprehensive-report.md, agent-product-planner.md 등)과 중복되지 않는 새로운 시각에 집중

---

## 현황 진단

### SWOT 분석

#### 강점 (Strengths)

- **Claude Code 설정 파일 호환성**: `.claude/settings.json`, `CLAUDE.md`, `AGENTS.md`를 그대로 읽는다. Claude Code 사용자가 설정 파일 수정 없이 전환할 수 있는 유일한 대안이다.
- **멀티 프로바이더 단일 UX**: 동일한 슬래시 커맨드와 TUI로 Claude/GPT/Gemini/DeepSeek/Qwen/로컬 모델을 전환한다. 사용자는 모델을 바꿔도 작업 흐름이 끊기지 않는다.
- **세션 지속성 아키텍처**: 세션 저장/재개/포크가 CLI 레이어에서 일급 기능으로 설계되어 있다. 단순 채팅 히스토리가 아니라 작업 단위를 영속화한다.
- **`-p` 파이프 모드**: `git diff | robota -p "요약해줘"` 같은 유닉스 철학에 맞는 파이프 합성이 가능하다. 개발자 자동화 스크립트에 내장할 수 있다.
- **백그라운드 서브에이전트**: 메인 세션과 병렬로 독립 에이전트를 실행하는 기능은 Aider와 Claude Code에는 없는 차별점이다.
- **권한 모드 4단계**: `plan(읽기 전용) → default → acceptEdits → bypassPermissions` 계층이 실제 개발 시나리오(리뷰 → 개발 → 믿을 수 있는 환경)에 대응된다.
- **스킬 시스템**: `.agents/skills/`에 마크다운으로 재사용 가능한 프롬프트 모듈을 정의하고 슬래시 커맨드로 호출할 수 있다. 팀 단위 지식 공유 도구로 확장 가능하다.
- **플러그인 아키텍처**: 기능 확장을 플러그인으로 분리하는 구조는 커뮤니티 생태계 형성의 기반이다.

#### 약점 (Weaknesses)

- **첫 실행 후 빈 화면**: 설정 완료 후 "무엇을 해야 할지" 힌트가 없다. 빈 입력 창만 표시된다.
- **기능 발견 경로가 단절됨**: `/help` 결과가 긴 텍스트 덤프다. 단계적 맥락 도움말이 없다.
- **에러 메시지 기술 용어 노출**: API 오류 시 HTTP 상태 코드, 스택 트레이스가 그대로 출력된다. 사용자에게 의미 있는 해결 방법으로 번역되지 않는다.
- **세션 이름 기본값이 ID**: 세션 목록에서 `abc123def`처럼 UUID가 표시된다. 내용을 보지 않으면 식별 불가.
- **백그라운드 작업 결과 알림 없음**: 백그라운드 에이전트 완료 시 TUI에 진입점 표시 없이 콘텐츠가 쌓인다.
- **상태바 정보 과부하**: 모델명, 컨텍스트 퍼센트, Git 브랜치, 권한 모드가 한 줄에 압축된다.
- **`/compact` 실행 후 무음 처리**: 대화 압축이 완료되어도 사용자에게 무엇이 삭제/요약되었는지 피드백이 없다.
- **설정 파일 우선순위 6단계**: 전문가도 어느 파일이 이겼는지 추적하기 어렵다. 활성 설정 출처 표시가 없다.

#### 기회 (Opportunities)

- **Claude Code 유료화/제한 반발 수요**: Claude Code가 일부 기능을 Sonnet 이상으로 제한하거나 가격을 올릴 때 즉시 대안이 될 수 있다.
- **기업 내부 배포 시장**: API 키를 팀 단위로 관리하고 권한을 제어해야 하는 기업 개발팀. 현재 Claude Code는 이 시나리오를 지원하지 않는다.
- **로컬 모델 수요 증가**: 보안/규정 이유로 클라우드 API를 쓸 수 없는 금융/의료/국방 개발자가 LM Studio 경로를 통해 robota를 채택할 수 있다.
- **CI/CD 파이프라인 통합**: `-p` 모드와 출력 포맷(`json`, `stream-json`)은 이미 자동화 통합 기반이 있다. GitHub Actions 마켓플레이스 액션 제공으로 Discovery가 가능하다.
- **MCP 서버 생태계 편승**: MCP 프로토콜 지원으로 VS Code Copilot, Claude Desktop 등 MCP 지원 제품의 백엔드 서버로 동작 가능하다.
- **한국 개발자 커뮤니티**: 한국어 README가 이미 존재하고, 메인테이너가 한국어 사용자다. 한국 커뮤니티 우선 공략으로 초기 사용자 확보가 가능하다.

#### 위협 (Threats)

- **Claude Code 빠른 개선 주기**: Anthropic이 Claude Code에 멀티 에이전트, 권한 제어를 빠르게 추가하면 차별점이 줄어든다.
- **Cursor/Copilot의 터미널 통합**: IDE 통합 도구들이 터미널 어시스턴트 기능을 추가하면 전환 비용이 줄어 CLI 전용 도구의 입지가 좁아진다.
- **beta 레이블 신뢰도 문제**: v3.0.0-beta.67은 "오래된 베타"처럼 보인다. 버전 번호가 제품 성숙도를 오해하게 한다.
- **npm 검색 노출 제로**: `robota`, `ai coding assistant cli` 검색에서 노출되지 않는다.

---

## 사용자 여정 분석

### 1단계: 설치 (Installation)

**현재 경험:**

```
npm install -g @robota-sdk/agent-cli
```

터미널에서 이 명령을 처음 실행한 사용자는:

1. 패키지가 설치되는 동안 아무 맥락 정보가 없다.
2. 설치 완료 후 `robota`를 실행하면 첫 실행 설정이 시작된다.

**문제점:**

- `npx @robota-sdk/agent-cli` (긴 패키지명)로 실행해야 한다. `npx robota`가 동작하지 않는다.
- 설치 후 `robota --help`가 첫 번째 직관적 행동인데, help 출력이 텍스트 덤프다.

**기회:**

- 설치 완료 메시지에 "다음 단계"를 출력하면 이탈을 막을 수 있다.

---

### 2단계: 첫 실행 (First Run Setup)

**현재 경험:**

1. 프로바이더 선택 (인터랙티브 피커)
2. API 키 입력 (마스킹 처리됨)
3. 모델 선택
4. 언어 선택
5. 설정 저장 → TUI 진입

**문제점:**

- 프로바이더 선택 화면에 각 프로바이더의 특성 설명이 없다. "anthropic"과 "openai"의 차이를 모르는 신규 사용자는 선택 기준이 없다.
- API 키를 어디서 발급받는지 링크가 없다.
- 로컬 모델(Gemma/LM Studio) 옵션이 클라우드 API와 동등하게 나열되지만, 로컬 모델을 선택하면 무엇을 설치해야 하는지 가이드가 없다.
- 설정 완료 후 빈 TUI가 표시된다. "이제 무엇을 하면 되나요?" 힌트가 없다.

**기회:**

- 첫 실행 완료 후 "튜토리얼 시작" / "탐색하기" / "바로 시작" 3가지 경로를 제시하면 다양한 페르소나에게 최적화된 진입점을 제공할 수 있다.

---

### 3단계: 일상 사용 (Daily Use)

**현재 경험:**

개발자는 보통 다음 순서로 robota를 사용한다:

1. 터미널에서 프로젝트 디렉토리에서 `robota` 실행
2. 코드 관련 질문이나 작업 입력
3. 허가 프롬프트에서 Approve/Deny 선택
4. 결과 확인

**문제점:**

- **컨텍스트 파악이 불투명**: "현재 어떤 파일이 컨텍스트에 포함되어 있나?"를 바로 알 수 없다. `/context`로 확인하지만, 매번 확인해야 한다는 사실을 모르는 사용자가 많다.
- **작업 진행률 표시 없음**: 장시간 실행 작업(대규모 리팩터링 등)에서 "지금 어느 단계인지"를 알 수 없다.
- **이전 세션 맥락 접근 불편**: `-c` 플래그(최근 세션 이어하기)가 있지만, "어제 하던 작업"으로 빠르게 돌아가는 UX가 없다.
- **허가 프롬프트 피로**: 반복 작업에서 동일한 툴 호출에 매번 승인이 필요하다. "이 세션에서 항상 허가" 이후 "모든 세션에서 항상 허가"로 이어지는 점진적 신뢰 계층이 없다.
- **출력 스크롤 관리**: 긴 대화에서 이전 출력이 터미널 버퍼 밖으로 사라진다. "이 응답 다시 보기"가 불가능하다.

---

### 4단계: 고급 사용 (Power Use)

**현재 경험:**

- 스킬 시스템으로 팀 공유 프롬프트 모듈화
- 백그라운드 서브에이전트로 병렬 작업
- 플러그인 시스템으로 기능 확장
- 세션 포크로 분기 실험

**문제점:**

- **스킬 작성 진입 장벽**: 스킬을 만들려면 마크다운 파일을 직접 작성하고 디렉토리에 배치해야 한다. "처음 스킬을 만들어보세요"로 가이드하는 경로가 없다.
- **백그라운드 에이전트 모니터링 단절**: 백그라운드 작업이 메인 TUI와 분리되어 있어 동시 모니터링이 불편하다.
- **플러그인 마켓플레이스 부재**: `/plugin install`이 있지만 어떤 플러그인이 있는지 탐색할 방법이 없다.
- **세션 검색 없음**: 세션이 많아질수록 `/session list` 출력이 길어지지만 검색/필터 기능이 없다.

---

## 경쟁 제품 대비 분석

### Claude Code 대비

| 항목                | Claude Code          | robota                       | 우위         |
| ------------------- | -------------------- | ---------------------------- | ------------ |
| 지원 모델           | Claude 전용          | 8개 프로바이더               | robota       |
| 로컬 모델 지원      | 없음                 | LM Studio/Gemma              | robota       |
| 설정 파일 호환      | `.claude/` 원본      | `.claude/` + `.robota/` 양쪽 | robota       |
| 백그라운드 에이전트 | 제한적               | 내장                         | robota       |
| 스킬 시스템         | 커스텀 슬래시 커맨드 | 마크다운 스킬 모듈           | 유사         |
| Web Playground      | 없음                 | 있음(베타)                   | robota       |
| 온보딩 경험         | 세련됨               | 기초적                       | Claude Code  |
| 문서/튜토리얼       | 풍부                 | 부족                         | Claude Code  |
| 브랜드 인지도       | 높음                 | 없음                         | Claude Code  |
| 오픈소스            | 아님                 | MIT                          | robota       |
| 기업 내부 배포      | 불가                 | 가능                         | robota       |
| CI/CD 통합          | 제한적               | `-p` 모드로 가능             | robota       |
| 출력 포맷           | 텍스트               | text/json/stream-json        | robota       |
| 세션 포크           | 없음                 | 있음                         | robota       |
| 플러그인 생태계     | 없음                 | 있음(생태계 미성숙)          | robota(잠재) |

**핵심 포지셔닝 기회**: Claude Code가 절대 할 수 없는 것은 "내 서버의 로컬 모델로, 내 인프라에서, API 키 없이 실행"이다. 이것이 robota의 1번 차별점이어야 한다.

---

### Cursor 대비

| 항목         | Cursor                | robota                 | 비고               |
| ------------ | --------------------- | ---------------------- | ------------------ |
| IDE 통합     | VS Code 기반 전체 IDE | 터미널 전용            | 다른 시장          |
| 실행 환경    | GUI                   | TUI + 파이프           | 개발자 선호도 분기 |
| 가격         | 유료($20/월)          | 무료(API 키 직접 사용) | robota 우위        |
| 원격 실행    | 불가                  | SSH 터미널에서 가능    | robota 우위        |
| 팀 설정 공유 | Cursor Rules          | AGENTS.md + 스킬       | 유사               |
| 자동화 통합  | 불가                  | `-p` 파이프            | robota 우위        |

**포지셔닝**: Cursor와 직접 경쟁보다 "서버/SSH/자동화/IDE 없는 환경"의 전문가 도구로 포지셔닝하면 된다.

---

### Aider 대비

| 항목          | Aider            | robota             | 비고             |
| ------------- | ---------------- | ------------------ | ---------------- |
| 언어          | Python           | TypeScript/Node.js | JS 생태계 친화도 |
| Git 통합      | 자동 커밋이 핵심 | 수동(도구 호출)    | Aider 특화       |
| 멀티 에이전트 | 없음             | 있음               | robota 우위      |
| Web UI        | 없음             | 있음               | robota 우위      |
| 플러그인      | 없음             | 있음               | robota 우위      |
| 세션 지속성   | 제한적           | 완전한 저장/재개   | robota 우위      |
| 비코딩 작업   | 어렵             | 범용 가능          | robota 우위      |
| 커뮤니티      | 활성화됨         | 없음               | Aider 우위       |

**포지셔닝**: "TypeScript 개발자를 위한 Aider". JS/TS 생태계 개발자가 Python 설치 없이 AI 코딩 어시스턴트를 쓸 수 있다.

---

## 개선 기획안

우선순위 기준: **P0** = 즉시/출시 블로커, **P1** = 고임팩트/1주일 내, **P2** = 중요/1개월 내, **P3** = 장기/로드맵

---

### P0 — 즉시 실행

#### 개선-01: `npx robota` 단축 실행 지원

**현재**: `npx @robota-sdk/agent-cli` 입력해야 함
**개선**: npm에 `robota` 패키지명 등록 또는 `bin` 필드에 `robota` 추가 확인
**임팩트**: 높음 — 공유 가능한 단일 명령으로 체험 진입 장벽 감소
**노력**: 낮음 — npm 패키지 별칭 등록 또는 `package.json` 수정
**근거**: `npx create-react-app`이 아니라 `npx react`처럼 기억하기 쉬운 명령이 viral 공유를 만든다.

---

#### 개선-02: 첫 실행 완료 후 "시작 힌트" 출력

**현재**: 설정 완료 후 빈 입력창만 표시
**개선**: 첫 실행 완료 직후 3~5개의 예시 프롬프트를 옅은 색상으로 표시

```
robota에 오신 것을 환영합니다! 시작해보세요:
  - "이 프로젝트 구조를 설명해줘"
  - "src/index.ts의 버그를 찾아줘"
  - "README.md를 작성해줘"
  /help 로 전체 명령어를 확인하세요.
```

**임팩트**: 높음 — 첫 3분 이탈률 감소
**노력**: 낮음 — `isFirstRun` 플래그 기반 조건부 렌더링

---

#### 개선-03: API 오류 메시지 사용자 친화적 번역

**현재**: `Error: 401 Unauthorized — invalid x-api-key`
**개선**:

```
API 키가 유효하지 않습니다.
  확인: ~/.robota/settings.json의 apiKey가 올바른지 확인하세요
  발급: https://console.anthropic.com → API Keys
  명령: robota --reset 으로 설정을 초기화할 수 있습니다
```

**임팩트**: 높음 — 첫 사용 실패 후 이탈 방지
**노력**: 중간 — HTTP 상태 코드별 메시지 매핑 테이블 작성

---

#### 개선-04: 프로바이더 선택 화면에 설명 추가

**현재**: `anthropic`, `openai`, `deepseek`, `gemma` 이름만 나열
**개선**: 각 프로바이더에 한 줄 설명과 무료/유료/로컬 뱃지 추가

```
> anthropic  [클라우드/유료] Claude 시리즈 — 코딩 작업 최강자
  openai     [클라우드/유료] GPT 시리즈 — 범용 어시스턴트
  deepseek   [클라우드/저가] DeepSeek — 고성능 저비용
  gemma      [로컬/무료]    LM Studio 로컬 모델 — API 키 불필요
  qwen       [클라우드/유료] 알리바바 Qwen — 중국어 특화
```

**임팩트**: 높음 — 선택 불확실성 제거로 첫 실행 완료율 향상
**노력**: 낮음 — 프로바이더 정의 파일에 description 필드 추가

---

### P1 — 1주일 내 실행

#### 개선-05: 활성 설정 출처 표시 (`/settings active`)

**현재**: 6단계 설정 파일 우선순위가 있지만 어느 파일이 이겼는지 알 수 없음
**개선**: `/settings active` 명령으로 현재 적용된 설정과 출처 파일을 표시

```
현재 활성 설정:
  provider: claude-sonnet-4-6    출처: .robota/settings.local.json
  language: ko                    출처: ~/.robota/settings.json
  permissions.allow: [...]        출처: .robota/settings.json
```

**임팩트**: 높음 — 디버깅 시간 대폭 감소, 팀 환경에서 필수
**노력**: 중간 — 설정 병합 시 출처 추적 로직 추가

---

#### 개선-06: 세션 자동 이름 생성 (AI 요약)

**현재**: 세션 이름이 UUID (`a1b2c3d4-...`)로 표시
**개선**: 첫 메시지 제출 후 세션 이름을 AI가 3~5단어로 자동 요약

```
세션 목록:
  1. refactor-auth-middleware    (어제 14:30)
  2. fix-database-connection     (2일 전)
  3. write-api-documentation     (5일 전)
```

**임팩트**: 중간-높음 — 세션 재개 UX를 실제 작업 흐름에 맞춤
**노력**: 중간 — 백그라운드 비동기 요약 호출 + 세션 메타데이터 저장

---

#### 개선-07: 진행 중인 작업에 단계 표시

**현재**: "에이전트가 작업 중..." 스피너만 표시
**개선**: 다단계 작업에서 현재 단계를 순차적으로 표시

```
[1/4] 파일 구조 파악 중...
[2/4] 관련 파일 읽는 중...
[3/4] 변경 사항 작성 중...
[4/4] 완료!
```

**임팩트**: 중간 — 장시간 작업에서 사용자 불안 감소
**노력**: 중간 — 툴 호출 이벤트 기반 단계 추정 로직

---

#### 개선-08: 컨텍스트 창 사용량 상시 표시 개선

**현재**: 상태바에 퍼센트만 표시 (`34%`)
**개선**: 컬러 코딩으로 위험도를 직관적으로 표시

```
상태바: [████░░░░ 45%]   ← 녹색: 여유
상태바: [███████░ 82%]   ← 노랑: 주의
상태바: [████████ 95%]   ← 빨강: 위험, /compact 권장
```

추가로 70% 도달 시 배너 경고 표시:

```
컨텍스트가 70% 사용되었습니다. /compact 로 압축하거나 /context 를 확인하세요.
```

**임팩트**: 높음 — 컨텍스트 초과 오류 예방
**노력**: 낮음 — 임계값 기반 색상 변경 로직 추가

---

#### 개선-09: `/compact` 실행 후 요약 피드백

**현재**: 대화 압축 후 무음 처리
**개선**: 압축 후 요약 리포트 출력

```
대화가 압축되었습니다.
  제거된 메시지: 47개 (전체의 60%)
  보존된 내용: 현재 작업 상태, 파일 수정 이력, 중요 결정 사항
  남은 컨텍스트: 18%
```

**임팩트**: 중간 — 압축 작업에 대한 신뢰 구축
**노력**: 낮음 — 압축 전후 메시지 수 비교 및 출력

---

#### 개선-10: 허가 프롬프트 "이 세션 항상 허가" 확장

**현재**: 개별 툴 호출마다 Approve/Deny, 세션 내 허가 기억
**개선**: 3단계 허가 메모리

```
[1] 이번 한 번만 허가
[2] 이 세션에서 항상 허가  ← 현재
[3] 이 프로젝트에서 항상 허가 (.robota/settings.local.json 자동 추가)
```

**임팩트**: 높음 — 반복 작업 마찰 대폭 감소
**노력**: 중간 — 허가 메모리 계층 추가 + 설정 파일 자동 쓰기

---

#### 개선-11: `/help` 출력 재설계 — 맥락 기반 도움말

**현재**: 전체 커맨드 목록을 한 번에 출력 (텍스트 덤프)
**개선**: 현재 상태에 맞는 관련 도움말 우선 표시

```
/help 를 입력했습니다.

지금 할 수 있는 것:
  /model    — 현재: claude-sonnet-4-6 (변경하려면)
  /context  — 컨텍스트 45% 사용 중 (확인하려면)
  /session  — 세션 저장/재개/포크

모든 커맨드 보기: /help all
```

**임팩트**: 높음 — 기능 발견성 개선
**노력**: 중간 — 현재 상태 주입 기반 도움말 렌더링

---

### P2 — 1개월 내 실행

#### 개선-12: GitHub Actions 공식 액션 제공

**개선**: `robota-sdk/robota-action@v1` GitHub Actions 액션 제공

```yaml
- uses: robota-sdk/robota-action@v1
  with:
    prompt: 'PR diff를 보고 코드 리뷰를 작성하세요'
    provider: anthropic
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    output-format: json
```

**임팩트**: 높음 — CI/CD 통합으로 신규 유입 채널 확보, GitHub Actions 마켓플레이스 검색 노출
**노력**: 중간 — Docker 이미지 + 액션 YAML 작성

---

#### 개선-13: 스킬 갤러리 명령어 (`/skills gallery`)

**현재**: 스킬을 직접 파일로 작성해야 함
**개선**: `/skills gallery` 명령으로 커뮤니티 공유 스킬 탐색 및 설치

```
/skills gallery
  인기 스킬:
  1. code-review     — PR 코드 리뷰 생성 (★ 234)
  2. commit-message  — 커밋 메시지 작성 (★ 189)
  3. test-generator  — 테스트 코드 생성 (★ 156)
  설치: /skills install code-review
```

**임팩트**: 높음 — 기능 발견성 + 커뮤니티 형성 동시 달성
**노력**: 높음 — 스킬 레지스트리 서버 + 프로토콜 설계 필요

---

#### 개선-14: 세션 검색 및 필터

**현재**: `/session list`가 시간순 목록만 제공
**개선**: 키워드 검색 및 날짜 필터 지원

```
/session list --search "authentication"
/session list --since 3d
/session list --provider anthropic
```

**임팩트**: 중간 — 세션이 누적될수록 가치 증가
**노력**: 중간 — 세션 메타데이터 인덱싱 + 검색 로직

---

#### 개선-15: 인라인 파일 미리보기

**현재**: Edit/Write 툴 결과를 diff 블록으로 표시
**개선**: `@파일경로` 입력 시 파일 내용을 접을 수 있는 미리보기로 표시

```
> @src/auth.ts 의 JWT 검증 로직을 리뷰해줘

[📄 src/auth.ts — 142줄 — 펼치기]
```

**임팩트**: 중간 — 컨텍스트 파악 속도 향상
**노력**: 중간 — Ink 컴포넌트 + 파일 내용 접기/펼치기 UI

---

#### 개선-16: 멀티 세션 TUI 탭 네비게이션

**현재**: 한 번에 하나의 세션만 활성화, 백그라운드 에이전트는 별도 뷰
**개선**: Ctrl+Tab으로 메인/백그라운드 에이전트 간 탭 이동

```
[★ main] [⚙ bg-agent-1: 실행중] [✓ bg-agent-2: 완료]
─────────────────────────────────────────────
현재: main 세션
>
```

**임팩트**: 높음 — 백그라운드 에이전트 UX 대폭 개선 (MULTI-001 보완)
**노력**: 높음 — TUI 멀티플렉서 아키텍처 필요

---

#### 개선-17: 프로젝트 초기화 마법사 (`robota init`)

**개선**: 새 프로젝트에서 `robota init`으로 AGENTS.md 자동 생성

```
robota init 을 실행합니다.

프로젝트 유형을 선택하세요:
> TypeScript Node.js 백엔드
  React/Next.js 프론트엔드
  Python 스크립트
  단일 파일 프로젝트

AGENTS.md와 .robota/settings.json을 생성합니다.
```

**임팩트**: 높음 — 프로젝트 설정 시간 단축 + Claude Code 사용자 전환 마찰 제거
**노력**: 중간 — 템플릿 파일 + 인터랙티브 마법사 구현

---

#### 개선-18: 실행 비용 대시보드 (`/cost` 개선)

**현재**: `/cost`가 세션 정보를 출력하지만 비용 추적이 제한적
**개선**: 실제 API 비용을 실시간으로 추적하고 일/주/월 집계 표시

```
/cost
  이번 세션: $0.043 (입력 45,000토큰 + 출력 12,000토큰)
  오늘: $0.187
  이번 주: $1.24
  모델별: anthropic $0.98, deepseek $0.26

예산 알림 설정: /cost budget 5.00
```

**임팩트**: 중간-높음 — 비용 가시성 확보로 장기 사용 지속성 향상
**노력**: 중간 — 토큰 사용량을 비용으로 변환하는 모델별 단가 테이블 + 집계 스토리지

---

#### 개선-19: `--dry-run` 플래그 (실행 전 계획 미리보기)

**개선**: `robota --dry-run` 또는 세션 내 `/dryrun` 으로 다음 작업 계획만 출력하고 실행하지 않음

```
robota --dry-run "src/에 있는 모든 console.log를 제거해줘"

계획:
  1. src/ 디렉토리의 .ts 파일 검색 (Glob)
  2. 각 파일에서 console.log 패턴 검색 (Grep)
  3. 12개 파일, 47개 라인 수정 예정 (Edit)

실행하려면: robota "src/에 있는 모든 console.log를 제거해줘"
```

**임팩트**: 높음 — 고위험 작업 전 신뢰 구축, `plan` 권한 모드보다 명시적
**노력**: 중간 — `plan` 모드 활용 + 계획 요약 출력 포맷

---

#### 개선-20: 키보드 단축키 가이드 상시 표시 토글

**현재**: 키보드 단축키가 README에만 있고 TUI에서 바로 확인 불가
**개선**: `?` 키 또는 `Ctrl+?`로 인라인 단축키 오버레이 표시

```
┌─ 키보드 단축키 ────────────────────────┐
│  Enter      메시지 제출               │
│  ESC        현재 실행 중지            │
│  Ctrl+C     즉시 종료                 │
│  ↑/↓        입력 히스토리 탐색        │
│  Tab        자동완성 선택             │
│  ?          이 도움말 닫기            │
└───────────────────────────────────────┘
```

**임팩트**: 중간 — TUI 처음 사용자의 기능 발견성 향상
**노력**: 낮음 — 오버레이 컴포넌트 추가

---

#### 개선-21: 프롬프트 히스토리 검색 (Ctrl+R)

**현재**: ↑/↓ 방향키로 이전 메시지 탐색
**개선**: Bash의 Ctrl+R처럼 역방향 검색으로 이전 프롬프트 찾기

```
(역방향 검색): refactor
  > "src/auth 모듈 전체를 리팩터링해줘"   ← 3일 전
  Enter로 재실행, Tab으로 편집
```

**임팩트**: 중간 — 반복 사용 패턴에서 효율성 향상
**노력**: 중간 — 프롬프트 히스토리 인덱싱 + 검색 UI

---

#### 개선-22: 팀 설정 공유 (`robota team`)

**개선**: 팀 단위 설정 배포 지원

```
robota team init       # 팀 설정 저장소 초기화
robota team push       # 현재 스킬/설정을 팀 저장소에 푸시
robota team pull       # 팀 저장소의 스킬/설정을 가져옴
robota team status     # 로컬 vs 팀 설정 차이 표시
```

**임팩트**: 높음 — 기업/팀 채택을 위한 핵심 기능, B2B 유입 경로
**노력**: 높음 — 팀 설정 프로토콜 + 저장소 통합 설계

---

#### 개선-23: 응답 스트리밍 일시정지/재개

**현재**: 스트리밍 응답 중 ESC로 중단하면 부분 결과만 남음
**개선**: 스트리밍 중 Space로 일시정지, 다시 Space로 재개

**임팩트**: 낮음-중간 — 긴 응답 중 내용 확인 후 계속 받기
**노력**: 중간 — 스트리밍 제어 이벤트 추가

---

### P3 — 로드맵 (장기)

#### 개선-24: VS Code 익스텐션 (TUI → IDE 브릿지)

**개선**: robota CLI를 VS Code 터미널 패널에서 실행할 때 현재 열린 파일/선택 영역을 자동으로 컨텍스트에 포함하는 익스텐션

**임팩트**: 높음 — Cursor 대비 포지셔닝 확보, VS Code 사용자 접근
**노력**: 높음 — VS Code API + 양방향 컨텍스트 공유 프로토콜

---

#### 개선-25: 작업 템플릿 마켓플레이스

**개선**: "코드 리뷰 에이전트", "문서 작성 에이전트", "테스트 생성 에이전트" 같은 목적별 에이전트 구성 템플릿을 원클릭으로 설치하는 마켓플레이스

**임팩트**: 높음 — 신규 사용자 AHA 모먼트 단축, 커뮤니티 생태계 성장
**노력**: 높음 — 템플릿 레지스트리 서버 + 설치 프로토콜

---

## 추천 백로그 항목

아래는 기존 백로그에 없는 신규 항목이다.

---

### UX-010: 첫 실행 완료 후 시작 힌트 출력

```yaml
---
title: 'UX-010: 첫 실행 완료 후 시작 힌트 출력 (welcome message)'
status: todo
created: 2026-05-23
priority: high
urgency: now
area: packages/agent-cli, packages/agent-interface-tui
depends_on: []
---
```

첫 실행 설정 완료 직후 TUI에 3~5개의 예시 프롬프트와 기본 커맨드 힌트를 출력한다. `isFirstRun` 플래그로 조건부 표시하며 이후 실행에는 표시하지 않는다.

**카테고리**: 온보딩 UX
**임팩트**: 높음 | **노력**: 낮음

---

### UX-011: API 오류 메시지 사용자 친화적 변환

```yaml
---
title: 'UX-011: API 오류 메시지 사용자 친화적 변환 (error message humanization)'
status: todo
created: 2026-05-23
priority: high
urgency: now
area: packages/agent-cli, packages/agent-framework
depends_on: []
---
```

HTTP 상태 코드별(401, 403, 429, 500, 503) 사용자 친화적 메시지 매핑 테이블을 작성하고, 각 메시지에 해결 방법 링크와 CLI 명령을 포함한다.

**카테고리**: 오류 UX
**임팩트**: 높음 | **노력**: 낮음

---

### UX-012: 프로바이더 선택 화면 설명 및 뱃지 추가

```yaml
---
title: 'UX-012: 프로바이더 선택 화면 설명 및 클라우드/로컬 뱃지 추가'
status: todo
created: 2026-05-23
priority: high
urgency: now
area: packages/agent-cli, packages/agent-framework
depends_on: []
---
```

첫 실행 및 `/provider` 선택 화면에서 각 프로바이더에 한 줄 설명과 클라우드/로컬/무료/유료 분류 뱃지를 표시한다.

**카테고리**: 온보딩 UX
**임팩트**: 높음 | **노력**: 낮음

---

### UX-013: 활성 설정 출처 표시 명령어

```yaml
---
title: 'UX-013: /settings active — 현재 적용된 설정과 출처 파일 표시'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-command
depends_on: []
---
```

`/settings active` 명령으로 현재 적용된 설정 값과 해당 값이 어느 설정 파일에서 왔는지를 표시한다. 설정 디버깅에 필수적이다.

**카테고리**: 개발자 UX
**임팩트**: 높음 | **노력**: 중간

---

### UX-014: 세션 자동 이름 생성

```yaml
---
title: 'UX-014: 세션 자동 이름 생성 — 첫 메시지 기반 AI 요약'
status: todo
created: 2026-05-23
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-session
depends_on: []
---
```

세션 첫 메시지 제출 후 백그라운드에서 AI가 3~5단어 세션 이름을 생성한다. 세션 목록에서 UUID 대신 의미 있는 이름이 표시된다.

**카테고리**: 세션 UX
**임팩트**: 중간 | **노력**: 중간

---

### UX-015: 컨텍스트 창 사용량 컬러 코딩 및 임계값 경고

```yaml
---
title: 'UX-015: 컨텍스트 창 사용량 컬러 코딩 (녹/황/적) 및 임계값 경고 배너'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-interface-tui
depends_on: []
---
```

상태바의 컨텍스트 사용량을 퍼센트 기준으로 녹색(0~60%), 노랑(60~85%), 빨강(85~100%) 으로 컬러 코딩한다. 70% 도달 시 `/compact` 권장 배너를 표시한다.

**카테고리**: 컨텍스트 관리 UX
**임팩트**: 높음 | **노력**: 낮음

---

### UX-016: `/compact` 실행 후 요약 리포트

```yaml
---
title: 'UX-016: /compact 실행 후 압축 결과 요약 리포트 출력'
status: todo
created: 2026-05-23
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-command
depends_on: []
---
```

`/compact` 실행 후 제거된 메시지 수, 보존된 내용 요약, 남은 컨텍스트 비율을 출력한다.

**카테고리**: 컨텍스트 관리 UX
**임팩트**: 중간 | **노력**: 낮음

---

### UX-017: 허가 프롬프트 3단계 메모리 (프로젝트 영구 허가)

```yaml
---
title: 'UX-017: 허가 프롬프트 3단계 메모리 — 프로젝트 영구 허가 추가'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-framework
depends_on: []
---
```

허가 프롬프트에 "이 세션에서 항상 허가"(현재) 외에 "이 프로젝트에서 항상 허가"(.robota/settings.local.json 자동 추가) 옵션을 추가한다.

**카테고리**: 권한 UX
**임팩트**: 높음 | **노력**: 중간

---

### CLI-010: `robota init` 프로젝트 초기화 마법사

```yaml
---
title: 'CLI-010: robota init — 프로젝트 AGENTS.md 및 .robota/settings.json 초기화 마법사'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---
```

`robota init` 명령으로 프로젝트 유형(Node.js, Python, React 등)을 선택하면 맞춤형 AGENTS.md와 .robota/settings.json을 생성한다. Claude Code 사용자의 전환 마찰을 줄인다.

**카테고리**: 온보딩
**임팩트**: 높음 | **노력**: 중간

---

### CLI-011: GitHub Actions 공식 액션 제공

```yaml
---
title: 'CLI-011: GitHub Actions 공식 액션 (robota-sdk/robota-action@v1)'
status: todo
created: 2026-05-23
priority: high
urgency: later
area: packages/agent-cli, 별도 저장소
depends_on: []
---
```

`robota-sdk/robota-action@v1` GitHub Actions 액션을 제공하여 PR 코드 리뷰, 문서 생성, 테스트 실행 등 CI/CD 파이프라인 통합을 지원한다. GitHub Actions 마켓플레이스 검색 노출로 새로운 발견 채널 확보.

**카테고리**: 자동화 통합
**임팩트**: 높음 | **노력**: 중간

---

### CLI-012: `--dry-run` 플래그 — 실행 전 계획 미리보기

```yaml
---
title: 'CLI-012: --dry-run 플래그 — plan 모드 기반 작업 계획 미리보기'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli
depends_on: []
---
```

`robota --dry-run "작업 내용"` 실행 시 실제 파일 수정 없이 에이전트의 계획(어떤 파일을 어떻게 바꿀지)만 출력한다. `plan` 권한 모드를 활용하여 구현한다.

**카테고리**: 안전 UX
**임팩트**: 높음 | **노력**: 중간

---

### UX-018: 키보드 단축키 인라인 오버레이 (`?` 키)

```yaml
---
title: 'UX-018: ? 키 인라인 단축키 오버레이 — TUI 내 도움말 즉시 접근'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-interface-tui
depends_on: []
---
```

TUI에서 `?` 키를 누르면 키보드 단축키 오버레이가 표시된다. 새 사용자의 기능 발견성을 높이고 문서를 찾아볼 필요를 줄인다.

**카테고리**: 기능 발견성
**임팩트**: 중간 | **노력**: 낮음

---

### UX-019: 실행 비용 추적 및 예산 알림

```yaml
---
title: 'UX-019: /cost 개선 — 실시간 비용 추적 및 예산 알림 설정'
status: todo
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-command
depends_on: []
---
```

세션별, 일별, 주별, 월별 API 비용을 실시간으로 추적하고 `/cost budget <금액>` 으로 예산 알림을 설정할 수 있다. 모델별 단가 테이블을 내장한다.

**카테고리**: 비용 관리
**임팩트**: 중간-높음 | **노력**: 중간

---

### MKT-010: `npx robota` 단축 실행 지원

```yaml
---
title: 'MKT-010: npx robota 단축 실행 — npm 패키지명 별칭 등록'
status: todo
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli, npm 배포
depends_on: []
---
```

`npx robota` 한 명령으로 즉시 실행할 수 있도록 npm에 `robota` 패키지를 등록한다. (현재: `npx @robota-sdk/agent-cli`). 바이럴 공유 가능한 단일 명령 확보.

**카테고리**: 마케팅/배포
**임팩트**: 높음 | **노력**: 낮음

---

_이 문서는 기존 분석(comprehensive-report.md, agent-product-planner.md, agent-ceo.md, agent-web-designer.md)과 중복되지 않는 새로운 개선안에 집중하였다. 기존 분석이 다룬 랜딩 페이지 개선, 신뢰 신호 배지, 온보딩 결정 트리, 플레이그라운드 완성, SEO 등은 이 문서에서 의도적으로 생략하였다._
