# 시니어 PM 검토: robota CLI 제품 전략 및 로드맵

> 작성일: 2026-05-23  
> 분석자: 시니어 프로덕트 매니저  
> 제품 버전: v3.0.0-beta.67  
> 기준 자료: 백로그 전체, 기존 분석 보고서(2026-05-18), 코드베이스 구조, 경쟁 환경

---

## 사용자 페르소나

### P1 — 멀티 프로바이더 탈출자 (핵심 타겟, 35%)

**이름**: 이민준 / 소프트웨어 엔지니어, 5년차  
**상황**: Claude Code 또는 Cursor를 쓰고 있지만 특정 공급자에 락인되는 것이 불편하다. GPT-4o와 Claude를 번갈아 쓰고 싶고, DeepSeek 같은 저가 모델을 실험하고 싶다.  
**고통**: "왜 내 AI 도구가 Anthropic 것만 써야 해? 모델 선택 자유가 없다."  
**트리거**: 월 $20 Claude Pro 구독료 + API 키 비용 이중 지불에 지쳐서 BYOK 도구를 검색한다.  
**기대**: `npx robota` 한 번으로 여러 모델을 전환하며 쓸 수 있고, API 비용을 직접 통제하고 싶다.  
**채택 조건**: 첫 5분 안에 ChatGPT API 키로 실제 코딩 작업이 완료되는 경험.

---

### P2 — SDK 통합 개발자 (성장 타겟, 25%)

**이름**: 김수연 / 풀스택 개발자, SaaS 스타트업  
**상황**: 자사 제품에 AI 코딩 어시스턴트 기능을 붙이고 싶다. LangChain은 너무 복잡하고 Claude API 직접 연동은 스트리밍·툴 호출을 직접 구현해야 해서 부담스럽다.  
**고통**: "AI 에이전트 런타임을 처음부터 짜는 건 6개월 짜리 작업인데, 우리 팀엔 그 시간이 없다."  
**트리거**: npm에서 `ai agent sdk typescript`를 검색하다가 robota를 발견한다.  
**기대**: `@robota-sdk/agent-framework`를 npm install 하고, 플러그인만 붙이면 동작한다.  
**채택 조건**: Getting Started 문서 + 실행 가능한 예제 코드 5개 이상. TypeScript 타입이 완전해야 한다.

---

### P3 — AI 도구 헤비 유저 / 프리랜서 (즉시 전환 가능, 20%)

**이름**: 박지훈 / 프리랜서 개발자  
**상황**: Aider, Cline, Cursor를 모두 써봤다. 각각 장단점이 있고 하나로 통일하고 싶다.  
**고통**: 프로젝트마다 다른 AI 도구를 쓰는 것이 피로하다. 터미널 기반으로 전부 해결하고 싶다.  
**트리거**: X(트위터) 또는 Hacker News에서 "Claude Code 대안"으로 robota가 언급된다.  
**기대**: `/skills`, `/memory`, `/session` 같은 고급 기능이 실제로 작동하고, 커스터마이징이 가능하다.  
**채택 조건**: 기존에 쓰던 도구보다 체감 속도 또는 비용이 확연히 낮아야 한다.

---

### P4 — 기업 내 AI 도구 도입 담당자 (장기 타겟, 20%)

**이름**: 최영호 / 테크 리드, 중견 IT 기업  
**상황**: 팀 전체에 AI 코딩 도구를 도입하려는데, SaaS 구독 비용과 데이터 보안이 걸린다. 온프레미스 또는 self-hosted 옵션이 필요하다.  
**고통**: "Claude Code는 데이터가 Anthropic 서버를 경유한다. 보안팀에서 허가 안 해준다."  
**트리거**: 오픈소스, MIT 라이선스, BYOK, self-hosted 가능한 CLI 도구를 찾다가 robota를 발견한다.  
**기대**: 내부 LLM(Ollama, LM Studio)과 연동 가능하고, 팀 단위 설정 배포가 가능하다.  
**채택 조건**: 엔터프라이즈 문의 채널 + 설치 가이드 + 보안 정책 문서가 있어야 한다.

---

## 핵심 가치 제안 분석

### 현재 포지셔닝의 문제

현재 README의 설명 — _"A TypeScript framework for building AI agents with multi-provider support"_ — 은 포지셔닝이 아니라 기능 목록이다. 이것은 "왜 써야 하는가"가 아니라 "무엇인가"에만 답한다.

### 재정의: 3개 차별점 포지셔닝

```
robota = "The open-source AI coding CLI that works with any provider."
         오픈소스  +  어떤 AI도 연결  +  CLI 코딩 어시스턴트
```

| 차원                   | robota       | Claude Code  | Cursor       | Aider  | Cline |
| ---------------------- | ------------ | ------------ | ------------ | ------ | ----- |
| 공급자 선택 자유       | ✅ 8개       | ❌ Claude만  | △ 제한적     | ✅     | ✅    |
| BYOK (API 직접 비용)   | ✅           | ❌ 구독 필수 | △ 구독 + API | ✅     | ✅    |
| 터미널 네이티브 TUI    | ✅           | ✅           | ❌ IDE       | ✅     | △     |
| SDK로 앱에 임베딩      | ✅           | ❌           | ❌           | ❌     | ❌    |
| 플러그인 생태계 (npm)  | ✅ 설계됨    | ✅           | ❌           | 제한적 | ❌    |
| 오픈소스 (MIT)         | ✅           | ✅           | ❌           | ✅     | ✅    |
| Self-hosted 가능       | ✅           | ❌           | ❌           | ✅     | △     |
| 스킬 시스템 (마크다운) | ✅           | ✅           | ❌           | ❌     | ❌    |
| 멀티 에이전트 TUI      | ✅ (개발 중) | 제한적       | ❌           | ❌     | ❌    |

### 핵심 차별점: SDK 이중성

robota의 가장 독보적인 강점은 **CLI 사용자 도구이면서 동시에 개발자 SDK**라는 점이다. 이는 경쟁 제품 어디에도 없다. Claude Code를 자신의 앱에 임베딩할 수 없지만, `@robota-sdk/agent-framework`는 npm install 한 번으로 임베딩 가능하다.

이 포지셔닝을 전면에 내세워야 한다:

> "Use it as a CLI. Embed it in your app. Both with the same package."

---

## 채택 장벽 및 해결 방안

### 장벽 1: Time-to-Value가 너무 길다 (가장 치명적)

**현상**: 신규 사용자가 `npm install -g @robota-sdk/agent-cli` 후 처음 마주치는 것이 Provider 설정 화면이다. API 키가 없으면 아무것도 할 수 없다.  
**수치 추정**: 첫 5분 안에 AHA 모먼트를 경험하지 못하면 90% 이탈 (업계 통계 기준)  
**해결 방안**:

- 키 없이 체험 가능한 데모 모드 (Public Playground BYOK — PROD-001에서 일부 추진 중)
- `robota demo` 커맨드: 사전 준비된 Gemini Free Tier 또는 로컬 모델 연결로 즉시 체험
- Onboarding Wizard: API 키 보유 여부 → 공급자 추천 → 즉시 첫 대화

### 장벽 2: Node.js 22 요구 사항이 너무 높다

**현상**: 대부분의 개발자 환경은 Node 18~20이다. 설치 직후 크래시가 발생한다.  
**해결 방안**: UX-001이 일부 커버하지만, 더 근본적으로 Node 18 지원을 위한 호환성 검토 필요. 단기적으로는 nvm/volta 자동 설치 가이드를 설치 오류 메시지에 포함.

### 장벽 3: 문서가 기술 용어 중심이다

**현상**: 새 사용자는 "agent-framework, plugin, transport" 같은 내부 용어를 모른다.  
**해결 방안**:

- 사용 목적 중심 Getting Started: "코드 리뷰 받기", "파일 생성하기", "버그 수정하기" 3가지 시나리오별 가이드
- 용어 대신 결과물 중심 설명: "플러그인 시스템" → "한 줄로 기능 추가하기"

### 장벽 4: 신뢰 신호가 없다

**현상**: npm 배지, GitHub Stars, 사용 사례, 활성 커밋 증거가 어디에도 없다.  
**해결 방안**: README와 랜딩 페이지에 npm/GitHub 배지 즉시 추가, 첫 번째 "도입 사례" 블로그 포스팅, Changelog 공개.

### 장벽 5: 경쟁 대비 포지셔닝이 없다

**현상**: "왜 Claude Code 대신 robota를 써야 하나?"에 대한 답이 문서 어디에도 없다.  
**해결 방안**: Why robota 비교 페이지 또는 섹션 추가. 비용 계산기 (내 API 비용 vs 구독 비용)는 강력한 전환 유도 도구.

---

## 성장 전략 (Growth Levers)

### Lever 1: 바이럴 — "Claude Code 대안" 포지셔닝

**전략**: Hacker News, Reddit r/LocalLLaMA, r/AItools에서 "Claude Code 대안" 포지셔닝으로 등장. 검색 의도 기반 SEO("claude code alternative open source", "self-hosted ai coding cli").  
**실행**: 비교 블로그 포스트 1편 → HN Show HN 게시 → 커뮤니티 Q&A 참여.

### Lever 2: 생태계 — 플러그인 마켓플레이스

**전략**: npm 플러그인 생태계가 형성되면 각 플러그인 작성자가 robota를 자연스럽게 홍보한다. Obsidian, Raycast 생태계의 성장 패턴 참조.  
**실행**: `@robota-sdk/plugin-*` 네이밍 컨벤션 + 공식 플러그인 레지스트리 페이지 + 첫 번째 공식 플러그인 5개 (Jira, Notion, GitHub, Slack, Linear).

### Lever 3: 커뮤니티 — 스킬 공유 레포

**전략**: 마크다운 기반 스킬 시스템은 비개발자도 기여할 수 있는 가장 쉬운 진입로다. "스킬 공유 레포" (robota-sdk/skills) 를 별도로 운영하면 커뮤니티 콘텐츠가 자연스럽게 축적된다.  
**실행**: GitHub `robota-skills` 공개 레포 → 첫 번째 스킬 컬렉션 20개 공개 → 기여 가이드.

### Lever 4: 개발자 콘텐츠 마케팅

**전략**: "나만의 AI 코딩 어시스턴트를 만들어라" 시리즈. YouTube 튜토리얼, 블로그 심화 가이드, Dev.to/Zenn 연재.  
**실행**: 월 1편 기술 블로그 + 분기 1편 YouTube 튜토리얼. 주제: "ChatGPT API 키로 Claude Code 같은 도구 만들기".

### Lever 5: SDK 임베딩 — B2B 개발자 채널

**전략**: "당신의 앱에 AI 코딩 어시스턴트를 붙여드립니다" 포지셔닝. VS Code Extension, JetBrains Plugin, Slack Bot, GitHub Action 형태의 레퍼런스 구현 공개.  
**실행**: `@robota-sdk/agent-framework` 임베딩 예제 레포 공개 → Product Hunt 런치 → 개발자 뉴스레터 (TLDR, JavaScript Weekly) 게재 신청.

---

## 수익화 전략

### 전제: 오픈소스 코어는 절대 훼손하지 않는다

MIT 라이선스 CLI와 SDK는 영구 무료로 유지한다. 수익화는 코어 위에 쌓이는 부가 가치 레이어에서만 발생한다.

### 단계 1 — Foundation (현재~6개월): 무수익, 사용자 확보

- 전면 무료
- GitHub Stars, npm 다운로드, Discord/Slack 커뮤니티 규모를 핵심 지표로 관리
- 수익 시도 전 MAU 1,000명 이상 달성이 조건

### 단계 2 — Freemium Cloud (6~18개월): 첫 수익화

**robota Cloud** (SaaS 레이어):

- 무료 티어: 세션 히스토리 30일 보존, 공유 링크 3개
- Pro ($12/월): 무제한 세션 히스토리, 팀 공유, 원격 스킬 동기화, 우선 지원
- 핵심 원칙: CLI 사용 자체는 Cloud 없이도 완전히 동작해야 한다

**플러그인 마켓플레이스 수수료**:

- 유료 플러그인 거래에서 15% 수수료 (Shopify App Store 모델)
- 초기 1년은 수수료 0%로 생태계 형성 우선

### 단계 3 — Enterprise (12개월+): 주요 수익원

**robota Enterprise**:

- 온프레미스 배포 지원 + 사내 LLM 연동 패키지
- SSO (SAML/OIDC), 감사 로그, 팀 정책 관리
- 연간 계약 기반 SLA
- 가격: 시트당 $30~50/월 (Cursor Business $40/월 참조)

**Professional Services**:

- SDK 커스텀 통합 컨설팅 (1회성, 프로젝트 단위)
- 기업 온보딩 트레이닝

### 수익화 원칙 요약

| 레이어               | 모델                 | 예상 수익 시점 |
| -------------------- | -------------------- | -------------- |
| CLI + SDK 코어       | 영구 무료 (오픈소스) | —              |
| robota Cloud Pro     | $12/월 구독          | M+12           |
| 플러그인 마켓 수수료 | 15% (1년 후)         | M+18           |
| Enterprise           | 연간 계약            | M+18           |

---

## 제품 로드맵 (단기/중기/장기)

### Phase 1 — 단기: "첫인상을 고쳐라" (1~2개월)

**목표**: 신규 방문자의 Time-to-Value를 15분 → 5분으로 단축. 신뢰 신호 구축.

| 우선순위 | 항목                                                          | 근거                   |
| -------- | ------------------------------------------------------------- | ---------------------- |
| P0       | Getting Started 완전 재작성 (목적 중심, 3개 시나리오)         | 채택 장벽 #3 해소      |
| P0       | README 포지셔닝 메시지 교체 + 신뢰 배지 추가                  | 신뢰 신호 #0           |
| P0       | `robota --help` 완전 구현 (CLI2-001)                          | 첫 탐색 경험 차단 버그 |
| P1       | Onboarding Wizard: API 키 → 공급자 선택 → 첫 대화 플로우      | P1/P3 페르소나 TtV     |
| P1       | Node.js 버전 에러 메시지 + nvm 설치 가이드 자동 표시 (UX-001) | 설치 이탈 방지         |
| P1       | Why robota 비교 페이지 (vs Claude Code, Cursor, Aider)        | Lever 1 바이럴         |
| P2       | GitHub Discussions 개설 + CONTRIBUTING.md (MKT-001 일부)      | 커뮤니티 기반          |
| P2       | npm/GitHub 배지 + Changelog 공개 페이지                       | 신뢰 신호              |

**완료 기준**: GitHub Stars 500+, npm 주간 다운로드 200+, HN Show HN 1회 게시

---

### Phase 2 — 중기: "생태계의 씨앗" (3~6개월)

**목표**: 플러그인·스킬 생태계 초기 형성, SDK 임베딩 레퍼런스 공개, MAU 1,000명 달성.

| 우선순위 | 항목                                                         | 근거               |
| -------- | ------------------------------------------------------------ | ------------------ |
| P0       | 플러그인 개발 가이드 + 공식 플러그인 5개 공개                | Lever 2 생태계     |
| P0       | `robota-skills` 공개 레포 + 스킬 컬렉션 20개                 | Lever 3 커뮤니티   |
| P0       | SDK 임베딩 예제 레포 (React app, Express API, Next.js)       | P2 페르소나 채택   |
| P1       | Public Playground — BYOK로 브라우저에서 즉시 체험 (PROD-001) | P1/P3 체험 경로    |
| P1       | 멀티 에이전트 TUI (MULTI-001) — 차별화 데모 시나리오         | 경쟁 차별점 시각화 |
| P1       | Product Hunt 런치 준비 + 실행                                | MAU 급증 기회      |
| P1       | SDK 임베딩 YouTube 튜토리얼 시리즈 1편                       | Lever 4 콘텐츠     |
| P2       | AI 비용 계산기 — "내 사용량에 맞는 공급자" 추천 도구         | 전환 유도          |
| P2       | 로컬 LLM (LM Studio, Ollama) 공식 지원 + 가이드              | P3/P4 채택 확대    |

**완료 기준**: MAU 1,000+, 커뮤니티 플러그인 10개+, npm 주간 다운로드 1,000+

---

### Phase 3 — 장기: "플랫폼화" (6개월+)

**목표**: robota Cloud 런치, Enterprise 파이프라인 구축, 생태계 자생성 확보.

| 우선순위 | 항목                                               | 근거               |
| -------- | -------------------------------------------------- | ------------------ |
| P0       | robota Cloud Alpha — 세션 동기화, 팀 스킬 공유     | 수익화 Phase 2     |
| P0       | 플러그인 마켓플레이스 공식 사이트                  | Lever 2 + 수익     |
| P0       | Enterprise 온프레미스 패키지 (문의 채널 포함)      | P4 페르소나 + 수익 |
| P1       | robota Cloud Pro 정식 런치 ($12/월)                | 첫 수익            |
| P1       | 팀 플랜 — 공유 설정, 정책, 감사 로그               | P4 엔터프라이즈    |
| P1       | CI/CD 통합 — GitHub Actions, GitLab CI 공식 Action | B2B 통합 접점      |
| P2       | 임베디드 Playground 컴포넌트 (npm 패키지)          | P2 SDK 사용자 확장 |
| P2       | 모바일/웹 CLI 인터페이스 (브라우저 기반 TUI)       | 접근성 확대        |
| P2       | 파트너 공급자 프로그램 (AI 공급자사와 공동 마케팅) | 배포 채널 확대     |

**완료 기준**: MRR $5,000+, Enterprise POC 계약 2건+, MAU 5,000+

---

## KPI 및 성공 지표

### North Star Metric

**주간 활성 세션 수 (Weekly Active Sessions)** — CLI를 실제로 실행해 1회 이상 AI 응답을 받은 고유 설치 수.  
이 지표는 설치 수(허위 지표 위험)가 아니라 실제 사용 여부를 측정한다.

### 단계별 KPI

#### Phase 1 (1~2개월) — 인지도 + 첫인상

| KPI                     | 목표     | 측정 방법      |
| ----------------------- | -------- | -------------- |
| GitHub Stars            | 500+     | GitHub API     |
| npm 주간 다운로드       | 200+/주  | npm stats      |
| README → Install 전환율 | >15%     | GitHub traffic |
| HN/Reddit 언급 수       | 1건+     | 수동 모니터링  |
| 설치 에러 리포트 수     | <10건/주 | GitHub Issues  |

#### Phase 2 (3~6개월) — 채택 + 생태계

| KPI                             | 목표    | 측정 방법                      |
| ------------------------------- | ------- | ------------------------------ |
| MAU (월간 활성 사용자)          | 1,000+  | 익명 텔레메트리 (opt-in)       |
| Weekly Active Sessions          | 500+/주 | 동상                           |
| 커뮤니티 플러그인 수            | 10+     | npm @robota-sdk/plugin-\* 검색 |
| 공유 스킬 수                    | 50+     | robota-skills 레포 PR 수       |
| Discord/GitHub Discussions 멤버 | 200+    | 플랫폼 대시보드                |
| SDK 임베딩 프로젝트             | 5+      | GitHub 의존성 그래프           |

#### Phase 3 (6개월+) — 비즈니스

| KPI                      | 목표       | 측정 방법           |
| ------------------------ | ---------- | ------------------- |
| MRR                      | $5,000+    | Stripe 대시보드     |
| Pro 전환율               | MAU의 2%+  | 결제 데이터         |
| Enterprise 파이프라인    | 5건+       | CRM                 |
| NPS (Net Promoter Score) | 40+        | 분기별 설문         |
| 플러그인 마켓 GMV        | $1,000+/월 | 마켓플레이스 데이터 |

### 포기 신호 (알람 KPI)

- 설치 후 24시간 내 재사용률 < 20% → Onboarding 재설계 필요
- GitHub Issues "installation failed" 주간 5건 이상 → 즉시 트리아지
- npm 주간 다운로드 2주 연속 하락 → 원인 분석 + HN/Reddit 포스팅

---

## 추천 백로그 항목

> 기존 항목 (DOC-001, MKT-001/002, WEB-001~004, DOC2-003, PROD-001) 은 제외.  
> 아래는 PM 관점에서 새로 식별한 20개+ 항목이다.

---

### PM-001: Onboarding Wizard — API 키 없이도 첫 5분 경험 완성

- **설명**: 최초 실행 시 API 키 보유 여부를 묻고, 없을 경우 "Gemini Free Tier 받기" 또는 "로컬 모델(LM Studio) 연결" 경로를 안내하는 인터랙티브 온보딩 플로우 구현. 키 입력 후 바로 첫 대화로 진입.
- **우선순위**: critical
- **카테고리**: UX / Onboarding
- **근거**: P1 페르소나 채택 장벽 #1 해소. AHA 모먼트까지 거리 단축이 성장의 단일 최대 레버.

---

### PM-002: Why robota 비교 페이지

- **설명**: robota.io에 "Why robota?" 페이지 추가. Claude Code, Cursor, Aider, Cline과 기능·비용·자유도 비교표 제공. 비용 절감 계산기(월간 API 비용 vs 구독 비용) 포함.
- **우선순위**: high
- **카테고리**: Marketing / Landing
- **근거**: 신규 방문자의 "왜 써야 하나" 질문에 즉시 답해야 이탈을 막는다. Lever 1 바이럴 기반.

---

### PM-003: opt-in 익명 텔레메트리 시스템

- **설명**: 사용자 동의 기반 익명 사용 데이터 수집. 수집 항목: 주간 세션 수, 사용 공급자, 실행 완료 여부, 첫 오류 발생 지점. 절대 수집 금지: 코드 내용, 파일 경로, 프롬프트 내용.
- **우선순위**: high
- **카테고리**: Data / Growth
- **근거**: 현재 사용 데이터 전무. KPI 측정 불가. 제품 개선 의사결정의 기반이 없다.

---

### PM-004: `robota demo` 커맨드 — 키 없이 즉시 체험

- **설명**: `robota demo` 실행 시 사전 준비된 샌드박스 환경(Public Playground 백엔드 또는 로컬 mock)으로 연결. API 키 없이 실제 코딩 어시스턴트 경험 제공. 5분 또는 5회 응답 제한.
- **우선순위**: high
- **카테고리**: UX / Acquisition
- **근거**: 설치 → 체험 사이의 마찰 제거. Lever 1 바이럴 필수 조건. "설치하면 바로 된다"는 인상이 공유 유발.

---

### PM-005: 공식 플러그인 5종 (Starter Pack)

- **설명**: `@robota-sdk/plugin-github`, `@robota-sdk/plugin-notion`, `@robota-sdk/plugin-linear`, `@robota-sdk/plugin-jira`, `@robota-sdk/plugin-slack` 공식 플러그인 5종 개발 + 공개. 각각 README + 사용 예제 포함.
- **우선순위**: high
- **카테고리**: Ecosystem / Plugins
- **근거**: 플러그인 생태계 형성을 위한 씨앗. 공식 플러그인이 없으면 커뮤니티 플러그인도 나오지 않는다.

---

### PM-006: `robota-skills` 공개 커뮤니티 레포

- **설명**: `github.com/robota-sdk/skills` 공개 레포 생성. 카테고리별(코드 리뷰, 문서 작성, 테스트 생성, 리팩터링 등) 스킬 20개 초기 컬렉션 공개. 기여 가이드 + PR 템플릿.
- **우선순위**: high
- **카테고리**: Community / Ecosystem
- **근거**: 스킬 시스템은 비개발자도 기여 가능한 가장 쉬운 오픈소스 참여 경로. Lever 3 커뮤니티 형성 핵심.

---

### PM-007: AI 비용 계산기 웹 도구

- **설명**: robota.io에 "내 비용 계산하기" 인터랙티브 도구 추가. 입력: 하루 평균 코딩 시간, 사용 모델. 출력: Claude Code 구독 비용 vs robota + 직접 API 비용 월간 비교.
- **우선순위**: medium
- **카테고리**: Marketing / Conversion
- **근거**: BYOK가 핵심 차별점이지만 사용자가 직접 계산하지 않으면 피부로 느끼지 못한다. 전환 유도 도구.

---

### PM-008: SDK 임베딩 예제 레포 (3종)

- **설명**: `robota-sdk/examples` 레포에 임베딩 예제 3종 공개. (1) Next.js 앱 내 AI 코딩 어시스턴트, (2) Express API에서 에이전트 호출, (3) CLI 스크립트. 각각 README + 배포 버튼.
- **우선순위**: high
- **카테고리**: Developer Experience / SDK
- **근거**: P2 페르소나(SDK 통합 개발자)의 채택 조건. "코드 보고 판단" 패턴이 개발자 의사결정의 70%.

---

### PM-009: Product Hunt 런치 플랜

- **설명**: Product Hunt 런치 준비 작업. 제품 페이지 작성, 스크린샷/GIF 3종, 시연 영상 90초, 런치 당일 커뮤니티 알림 플랜. 런치 전 베타 사용자 100명 이상 확보 조건.
- **우선순위**: medium
- **카테고리**: Marketing / Growth
- **근거**: Product Hunt 런치는 초기 MAU 급증의 단일 최대 기회. 준비 없이 실행하면 역효과.

---

### PM-010: Changelog 공개 페이지 (robota.io/changelog)

- **설명**: 매 릴리즈마다 사용자 친화적 언어로 변경사항을 기록하는 공개 Changelog 페이지. GitHub Releases와 연동. 기술 용어 대신 "무엇이 달라졌나" 중심 설명.
- **우선순위**: medium
- **카테고리**: Trust / Community
- **근거**: "살아있는 프로젝트인가"를 판단하는 가장 빠른 신호. 비활성 프로젝트 인상 해소.

---

### PM-011: 로컬 LLM (Ollama, LM Studio) 공식 지원 + 전용 가이드

- **설명**: Ollama, LM Studio, llama.cpp 연동을 공식 지원하는 provider 어댑터 + 상세 설치 가이드. "API 키 없이 로컬 모델로 시작하기" 온보딩 경로.
- **우선순위**: high
- **카테고리**: Feature / Onboarding
- **근거**: P3(프리랜서), P4(기업) 페르소나 채택의 핵심. 로컬 LLM 사용자는 매우 충성도 높은 세그먼트.

---

### PM-012: 플러그인 개발 가이드 + 플러그인 디렉토리 페이지

- **설명**: "나만의 플러그인 만들기" 10분 가이드 작성. `@robota-sdk/plugin-template` starter 레포. robota.io/plugins 커뮤니티 플러그인 디렉토리 페이지 (curated list).
- **우선순위**: high
- **카테고리**: Ecosystem / Documentation
- **근거**: 생태계 형성의 전제 조건. 가이드 없이는 플러그인이 생기지 않는다.

---

### PM-013: "Show HN" + AI 커뮤니티 런치 캠페인

- **설명**: Hacker News Show HN 게시, Reddit r/LocalLLaMA + r/AItools 소개 포스팅, X(트위터) 개발 스레드. 각 플랫폼에 맞는 포지셔닝 메시지 준비.
- **우선순위**: medium
- **카테고리**: Marketing / Launch
- **근거**: 초기 사용자 획득의 가장 효율적인 채널. 비용 0, 영향 최대.

---

### PM-014: 사용자 인터뷰 프로그램 (월 5명)

- **설명**: 초기 사용자 중 월 5명을 모집해 30분 인터뷰 진행. 주제: 첫 인상, 포기한 순간, 가장 많이 쓰는 기능, 없어서 불편한 것. 결과를 월간 PM 보고서로 정리.
- **우선순위**: medium
- **카테고리**: Research / Product
- **근거**: 데이터 없이 제품 결정을 내리는 것은 도박. 초기 10~100명의 목소리가 제품 방향을 결정한다.

---

### PM-015: Enterprise 문의 채널 + 보안 정책 문서

- **설명**: robota.io에 Enterprise 문의 폼 추가. 보안 정책 페이지(데이터 처리, API 키 관리, 온프레미스 옵션). 30일 내 응답 보장 SLA.
- **우선순위**: medium
- **카테고리**: Business / Enterprise
- **근거**: P4 페르소나가 도입 검토를 시작할 때 가장 먼저 찾는 것이 보안 문서와 연락처. 없으면 즉시 이탈.

---

### PM-016: GitHub Actions 공식 Action 출시

- **설명**: `robota-sdk/action` GitHub Action 공개. CI/CD 파이프라인에서 robota를 호출해 코드 리뷰, 문서 생성, 테스트 작성 자동화. YAML 설정 + 예제 워크플로우.
- **우선순위**: medium
- **카테고리**: Integration / B2B
- **근거**: 팀 단위 B2B 채택의 핵심 진입로. GitHub Marketplace 노출로 신규 사용자 유입.

---

### PM-017: 분기별 공개 로드맵 페이지

- **설명**: robota.io/roadmap에 공개 로드맵 게시. 현재 개발 중 / 다음 분기 예정 / 검토 중 3단계 구분. GitHub Issues 투표 기능 연동으로 커뮤니티 우선순위 반영.
- **우선순위**: medium
- **카테고리**: Community / Trust
- **근거**: 오픈소스 신뢰의 핵심 요소. "이 프로젝트가 어디로 가는지"를 보여주면 장기 사용자가 형성된다.

---

### PM-018: 세션 공유 링크 기능

- **설명**: 완료된 세션(코드 리뷰, 리팩터링 작업 등)을 공개 링크로 공유할 수 있는 기능. "이 AI가 내 코드를 이렇게 개선했다"를 공유하면 자연스러운 바이럴 발생.
- **우선순위**: low
- **카테고리**: Viral / Social
- **근거**: Notion, Vercel 등이 공유 기능으로 바이럴을 일으킨 사례 참조. robota Cloud의 첫 번째 킬러 피처 후보.

---

### PM-019: JavaScript Weekly / TLDR 뉴스레터 게재 신청

- **설명**: JavaScript Weekly, TLDR Tech, Node Weekly, AI Breakfast에 robota 소개 게재 신청. 각 뉴스레터에 맞는 1단락 소개문 작성.
- **우선순위**: low
- **카테고리**: Marketing / Distribution
- **근거**: 구독자 수십만 명의 개발자 뉴스레터는 npm 다운로드를 단기간에 10배 끌어올릴 수 있다.

---

### PM-020: 온보딩 이탈 지점 분석 (Funnel 분석)

- **설명**: PM-003 텔레메트리가 구축되면, 설치 → 첫 실행 → 공급자 설정 → 첫 응답 수신 단계별 이탈률을 측정. 가장 이탈이 많은 단계에 리소스 집중.
- **우선순위**: high (PM-003 선행 필요)
- **카테고리**: Data / Growth
- **근거**: 어디서 떠나는지 모르면 무엇을 고쳐야 하는지 알 수 없다. 성장의 기초 데이터.

---

### PM-021: "Build with robota" 쇼케이스 페이지

- **설명**: robota SDK로 만든 프로젝트/제품을 소개하는 robota.io/showcase 페이지. 투고 폼 제공. 첫 번째 3개는 직접 발굴해 게시.
- **우선순위**: low
- **카테고리**: Community / Social Proof
- **근거**: "실제로 뭔가 만들어진다"는 증거가 P2(SDK 통합 개발자) 채택에 결정적 영향.

---

### PM-022: 정기 커뮤니티 콜 (월간)

- **설명**: 월 1회 Discord 또는 YouTube Live에서 개발 현황 공유 + Q&A. 30분 구성: 지난 달 변경사항 10분 + 다음 달 계획 10분 + Q&A 10분.
- **우선순위**: low
- **카테고리**: Community / Retention
- **근거**: 코어 커뮤니티 형성의 가장 효과적 방법. 소수 충성 사용자가 바이럴의 실제 엔진.

---

## 전략 요약

robota는 기술적으로 경쟁 준비가 된 제품이다. 그러나 지금 가장 큰 위험은 **아무도 모른다는 것**이다.

우선순위 행동 3가지:

1. **포지셔닝 고정 (즉시)**: README 첫 줄과 robota.io Hero 메시지를 "The open-source AI coding CLI. Any provider. BYOK."로 교체한다. 비용 없음, 1시간이면 된다.

2. **첫 5분 경험 수술 (2주 내)**: `robota --help` 구현 + Onboarding Wizard. 사람들이 떠나는 가장 큰 이유를 제거한다.

3. **Show HN 런치 (4주 내)**: 위 두 가지가 완료되면, 지금 가진 기술력으로 충분히 HN 프론트페이지를 狙える. 더 이상 기다릴 이유가 없다.

기술은 이미 만들어졌다. 이제 세상에 알릴 차례다.
