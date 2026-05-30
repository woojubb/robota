# 실리콘밸리 웹서비스 기획자 분석 리포트

**분석 대상:** Robota SDK — TypeScript AI 에이전트 SDK  
**분석 일자:** 2026-05-18  
**분석자 관점:** 실리콘밸리 시니어 웹서비스 기획자 (Stripe, Vercel, Linear 등 개발자 도구 SaaS 10년+)

---

## 1. 현재 강점

### 기술적 완성도

- **레이어드 아키텍처가 명확함.** `agent-core → agent-session → agent-framework → agent-cli` 의존성 방향이 단방향으로 정리되어 있고, 각 레이어가 독립 진입점으로 작동한다. 이는 LangChain이나 AutoGPT 대비 실제 프로덕션 코드베이스에서 이식성을 높이는 핵심 차별점이다.
- **멀티 프로바이더 단일 API.** Anthropic, OpenAI, Gemini, DeepSeek, Qwen, LM Studio(로컬)를 동일한 인터페이스로 스위칭할 수 있다. 벤더 락인 없이 모델을 교체할 수 있다는 점은 2026년 AI 가격 변동성 시대에 강력한 셀링포인트다.
- **TypeScript 타입 안전성.** `any` 없음, Zod 기반 툴 스키마, 엄격한 타입 시스템. 기업 프로덕션 도입 시 코드 리뷰 통과 가능성이 높다.
- **CLI가 즉시 사용 가능한 제품임.** SDK 외에 `robota` CLI 자체가 Claude Code와 직접 경쟁하는 완성된 코딩 어시스턴트다. 이 두 가지 포지션(SDK + 완성 제품)을 동시에 가진다는 것은 희귀한 강점이다.
- **트랜스포트 추상화.** HTTP, WebSocket, MCP, headless, TUI를 단일 `InteractiveSession` 게이트웨이로 통합한 설계는 Vercel의 엣지 런타임 멀티 타겟 전략과 유사하게 미래 확장성이 높다.

### 문서화

- Getting Started가 5단계 예제로 구조화되어 있고, 각 단계가 점진적으로 복잡도를 올린다.
- 아키텍처 문서에 패키지 역할 테이블, 의존성 방향, 데이터 플로우 다이어그램이 포함되어 있다.

---

## 2. 핵심 문제

### 문제 1: 3초 안에 "왜 Robota인가?"가 전달되지 않는다

메인 README의 첫 줄은 `"A TypeScript framework for building AI agents with multi-provider support, tool calling, and extensible plugin architecture."` — 이는 설명이지 가치 제안이 아니다. 개발자가 처음 랜딩했을 때 "이게 나에게 왜 필요한가?"를 3초 안에 이해할 수 없다. Stripe의 첫 문장("Payments infrastructure for the internet")과 비교하면 차이가 명확하다.

### 문제 2: 경쟁 포지셔닝이 없다

Claude Code와 직접 경쟁하는 CLI를 가지고 있음에도, "Claude Code와 다른 점", "LangChain 대비 무엇이 다른가"에 대한 명시적 언급이 없다. 개발자는 항상 "왜 이걸 써야 하나?" 를 묻는다. 이 질문에 대한 답이 문서 어디에도 없다.

### 문제 3: AHA 모먼트까지의 경로가 너무 길다

Getting Started의 "Your First Agent" 섹션은 훌륭하지만, Prerequisites에서 Node.js 22 + API 키를 요구한다. API 키 없이도 체험할 수 있는 경로(예: LM Studio 로컬 모델)가 Prerequisites에서 언급되지 않고 표 아래에 숨어 있다. 첫 번째 코드 실행까지 장벽이 높다.

### 문제 4: 개발자 신뢰 신호가 전혀 없다

GitHub stars, npm 주간 다운로드, "X팀이 사용 중", 스폰서, 기여자 수 — 어느 것도 없다. 신규 방문자가 "이게 활성 프로젝트인가?"를 판단할 근거가 없다.

### 문제 5: 플레이그라운드가 껍데기다

`apps/agent-web/src/app/playground/page.tsx`는 `PlaygroundApp` 컴포넌트를 dynamic import하는 6줄 파일이다. WebSocket URL을 환경변수로 받는다. 즉, 플레이그라운드가 실제 배포되어 작동 중인지 불분명하다. Vercel의 playground나 Linear의 온보딩 interactive demo 같은 "API 키 없이 30초 안에 작동하는 체험"이 없다.

### 문제 6: 블로그가 비어 있다

`apps/blog/src/pages/index.astro`는 기술적으로 완성된 레이아웃이지만, 실제 콘텐츠(포스트)가 얼마나 있는지 알 수 없다. 블로그는 개발자 신뢰 구축의 핵심 채널이다.

### 문제 7: "어느 레이어에서 시작해야 하나"가 혼란스럽다

README는 3개 레이어(CLI, Assembly, Agent Library)를 나열하지만, 99%의 신규 방문자에게 "당신에게 맞는 레이어는 이것"이라는 결정 트리가 없다. Getting Started는 5가지 예제를 순서 없이 나열한다.

### 문제 8: 패키지 이름이 직관적이지 않다

`agent-core`, `agent-framework`, `agent-session`, `agent-executor` — 이름만으로 "내가 어떤 걸 설치해야 하는가"를 판단하기 어렵다. npm 검색에서 발견될 가능성도 낮다.

### 문제 9: macOS Terminal 경고가 온보딩 첫 화면에 있다

Getting Started 두 번째 섹션에 `macOS Terminal.app: CJK input crash` 경고가 있다. 이 경고가 최초 온보딩 경험에서 부정적인 인상을 남긴다. 기술적으로 정확한 경고지만 배치 위치가 잘못되었다.

### 문제 10: CTA(Call to Action)가 모호하다

각 페이지 말미의 "What's Next" 링크는 존재하지만, 방문자를 강하게 다음 행동으로 이끄는 단일 CTA가 없다. Vercel의 "Deploy to Vercel" 버튼이나 Linear의 "Start free trial"처럼 하나의 명확한 행동 유도가 없다.

---

## 3. 우선순위 개선안

| #   | 개선안                                                                                      | 임팩트 | 구현 난이도 | 근거                         |
| --- | ------------------------------------------------------------------------------------------- | ------ | ----------- | ---------------------------- |
| 1   | [Hero Headline 교체](#개선안-1-hero-headline-교체)                                          | High   | Easy        | 랜딩 전환율 직접 영향        |
| 2   | [경쟁 포지셔닝 섹션 추가](#개선안-2-경쟁-포지셔닝-섹션-추가)                                | High   | Easy        | 개발자 채택 결정 핵심        |
| 3   | [온보딩 결정 트리(Use-Case Selector)](#개선안-3-온보딩-결정-트리use-case-selector)          | High   | Medium      | Getting Started 이탈률 감소  |
| 4   | [5분 Quick Win 경로 정의](#개선안-4-5분-quick-win-경로-정의)                                | High   | Easy        | AHA 모먼트 단축              |
| 5   | [신뢰 신호 배지 추가](#개선안-5-신뢰-신호-배지-추가)                                        | High   | Easy        | 채택 장벽 제거               |
| 6   | [Interactive Playground 완성](#개선안-6-interactive-playground-완성)                        | High   | Hard        | 체험 전환 핵심               |
| 7   | [macOS 경고 위치 이동](#개선안-7-macos-경고-위치-이동)                                      | Mid    | Easy        | 온보딩 첫인상 개선           |
| 8   | [블로그 런치 콘텐츠 3편](#개선안-8-블로그-런치-콘텐츠-3편)                                  | Mid    | Medium      | 개발자 커뮤니티 신뢰 구축    |
| 9   | [패키지 설치 가이드 재구성](#개선안-9-패키지-설치-가이드-재구성)                            | Mid    | Easy        | 설치 혼란 해소               |
| 10  | [단일 CTA 강화](#개선안-10-단일-cta-강화)                                                   | Mid    | Easy        | 전환 행동 명확화             |
| 11  | [로컬 모델(LM Studio) 첫 번째 경로 강조](#개선안-11-로컬-모델lm-studio-첫-번째-경로-강조)   | Mid    | Easy        | API 키 없는 체험 제공        |
| 12  | [Claude Code 호환성을 셀링포인트로 역전](#개선안-12-claude-code-호환성을-셀링포인트로-역전) | Mid    | Easy        | 기존 Claude Code 사용자 전환 |

---

## 4. 개선안 상세

### 개선안 1: Hero Headline 교체

**현재:** `"A TypeScript framework for building AI agents with multi-provider support, tool calling, and extensible plugin architecture."`

**문제:** 기능 나열. "나에게 왜 필요한가?"에 답하지 않는다.

**개선안 A (CLI 포지션):**

> Build your own Claude Code — in TypeScript, with any AI provider.

**개선안 B (SDK 포지션):**

> The TypeScript AI agent SDK that doesn't lock you into one model.

**개선안 C (균형):**

> AI agents that run anywhere. Switch providers without rewriting your code.

**구현:** `content/README.md` 첫 단락 수정. 30분 작업.

---

### 개선안 2: 경쟁 포지셔닝 섹션 추가

**현재:** "Why Robota SDK?" 섹션이 기능 불릿 리스트만 있다.

**개선안:** 비교 테이블 추가.

```markdown
## Robota vs Alternatives

|                                | Robota         | Claude Code         | LangChain           | OpenAI SDK direct |
| ------------------------------ | -------------- | ------------------- | ------------------- | ----------------- |
| Multi-provider (one API)       | ✅             | ❌ (Anthropic only) | ✅ (complex)        | ❌                |
| TypeScript-first, strict types | ✅             | ✅                  | ❌ (Python primary) | ✅                |
| Ready-to-use CLI included      | ✅             | ✅                  | ❌                  | ❌                |
| Self-hostable                  | ✅             | ❌                  | ✅                  | ✅                |
| MIT License                    | ✅             | ❌ (proprietary)    | ✅                  | ✅                |
| Local model support            | ✅ (LM Studio) | ❌                  | ✅                  | ❌                |
| Build custom agents (SDK)      | ✅             | ❌                  | ✅                  | limited           |
```

**구현:** `content/README.md` "Why Robota SDK?" 섹션에 테이블 추가. 1시간 작업.

---

### 개선안 3: 온보딩 결정 트리(Use-Case Selector)

**현재:** Getting Started가 다섯 가지 예제를 나열한다. 어디서 시작해야 할지 불분명하다.

**개선안:** 파일 상단에 결정 트리 추가.

```markdown
## Which path is right for you?

**"I want a coding assistant in my terminal right now"**
→ [CLI Quick Start](#quick-start--cli) ← 2분, API 키 필요

**"I want to build a chatbot or AI feature in my app"**
→ [First Agent (5 lines)](#1-create-a-simple-conversational-agent) ← 10분

**"I want to switch AI providers without rewriting code"**
→ [Switch Providers](#3-switch-providers-dynamically) ← 5분

**"I want to embed an AI assistant in my existing tool"**
→ [Using the SDK (InteractiveSession)](#4-use-the-sdk-for-project-aware-sessions) ← 15분

**"I have no API key and want to try for free"**
→ [Local Model with LM Studio](#local-model-no-api-key-required) ← 10분
```

**구현:** `content/getting-started/README.md` 최상단에 섹션 추가. 1시간 작업.

---

### 개선안 4: 5분 Quick Win 경로 정의

**현재:** Getting Started 첫 번째 예제가 `agent-core` + `agent-provider` + API 키 설정 + TypeScript 설정을 전제한다. 이미 TS 프로젝트가 있는 개발자에게는 좋지만 신규 방문자에게는 진입 장벽이 높다.

**개선안:** CLI를 "5분 경로"로 첫 번째에 배치하고, 설치-실행-AHA 3단계를 강조.

````markdown
## Fastest path: 2 minutes

```bash
npm install -g @robota-sdk/agent-cli
robota
```
````

→ 첫 실행 시 프로바이더 선택 + API 키 설정 가이드가 대화형으로 진행됨.
→ 완료 후 즉시 코딩 어시스턴트 사용 가능.

````

**구현:** Getting Started 재구성. 2시간 작업.

---

### 개선안 5: 신뢰 신호 배지 추가
**현재:** README에 GitHub stars, npm downloads, CI 상태, 라이선스 배지가 없다.

**개선안:** README 상단에 배지 라인 추가.

```markdown
[![npm version](https://img.shields.io/npm/v/@robota-sdk/agent-core)](https://www.npmjs.com/package/@robota-sdk/agent-core)
[![npm downloads](https://img.shields.io/npm/dm/@robota-sdk/agent-cli)](https://www.npmjs.com/package/@robota-sdk/agent-cli)
[![GitHub stars](https://img.shields.io/github/stars/woojubb/robota)](https://github.com/woojubb/robota)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](./tsconfig.json)
````

**배지 외 추가 신뢰 신호:**

- "Used by X projects on GitHub" (의존 프로젝트 수)
- 최근 커밋 날짜 배지 (활성 프로젝트임을 증명)
- "Beta" 상태를 명시하되, "production-ready beta"로 포지셔닝

**구현:** `content/README.md` 수정. 30분 작업.

---

### 개선안 6: Interactive Playground 완성

**현재:** `playground/page.tsx`는 WebSocket URL 환경변수를 받는 컴포넌트 래퍼다. 실제로 배포되어 작동하는 playground인지 불분명하다.

**목표 상태:** "API 키 없이 30초 안에 Robota를 체험"할 수 있는 hosted playground.

**구현 옵션 A (Easy, 임시 방편):** README에 playground 링크 대신 Replit/StackBlitz embed 추가.

```
[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/woojubb/robota/tree/main/examples/basic)
```

**구현 옵션 B (Hard, 장기 목표):** Vercel 서버에 고정 API 키(rate-limited)로 demo 엔드포인트를 운영하고, playground에서 직접 체험 가능하도록 구성.

**벤치마크:** Vercel AI SDK playground(sdk.vercel.ai/playground), OpenAI API playground(platform.openai.com/playground)

**구현:** 옵션 A는 1시간, 옵션 B는 1-2주.

---

### 개선안 7: macOS 경고 위치 이동

**현재:** Getting Started의 "I want a ready-to-use coding assistant" 설치 명령어 바로 아래에 `macOS Terminal.app CJK crash` 경고가 있다.

**문제:** 처음 보는 사람이 "이 SDK는 macOS에서 문제가 있구나"라는 부정적 첫인상을 받는다.

**개선안:** 경고를 Troubleshooting 섹션 또는 FAQ로 이동. 온보딩 경로에서 제거.

**구현:** `content/getting-started/README.md` 편집. 15분 작업.

---

### 개선안 8: 블로그 런치 콘텐츠 3편

**현재:** 블로그 인프라는 구축되어 있으나 실제 개발자 커뮤니티를 끌어들이는 콘텐츠가 없다.

**추천 런치 콘텐츠:**

1. **"Build a Claude Code alternative in 50 lines of TypeScript"** — 가장 높은 검색 의도 포착. Hacker News, Reddit r/typescript 타겟.
2. **"Multi-provider AI: how we switched from $0.015/1K tokens to $0.002/1K tokens without changing a line of agent logic"** — 비용 절감 스토리. 실무 개발자 공감 최고.
3. **"Why we built a strict TypeScript AI agent SDK (and banned `any`)"** — 아키텍처 철학 공유. Senior engineer 타겟.

**구현:** 각 포스트 작성 2-4시간. 총 1-2주.

---

### 개선안 9: 패키지 설치 가이드 재구성

**현재:** README의 Installation 섹션이 9개 패키지를 나열한다. 어떤 걸 설치해야 하는지 명확하지 않다.

**개선안:** 사용 목적별로 묶어서 제시.

````markdown
## Installation

### Just want the CLI?

```bash
npm install -g @robota-sdk/agent-cli
```
````

### Building a custom agent?

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider @anthropic-ai/sdk
```

### Building an app with multi-turn sessions?

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider @anthropic-ai/sdk
```

### Need tool calling?

```bash
# Add to any of the above:
npm install @robota-sdk/agent-tools zod
```

````

**구현:** `content/README.md` 편집. 1시간 작업.

---

### 개선안 10: 단일 CTA 강화
**현재:** 각 섹션에 "What's Next" 링크가 있지만 강도가 약하다.

**개선안:** README 상단에 두 개의 명확한 CTA 버튼(마크다운 링크 스타일).

```markdown
**[→ 2분 만에 CLI 설치하기](#quick-start--cli)** | **[→ 나만의 에이전트 만들기](#build-an-agent-agent-core)**
````

그리고 README 하단에:

````markdown
---

## Ready to build?

```bash
npm install -g @robota-sdk/agent-cli && robota
```
````

→ [Documentation](./getting-started/) · [Examples](./examples/) · [GitHub](https://github.com/woojubb/robota)

````

**구현:** `content/README.md` 편집. 30분 작업.

---

### 개선안 11: 로컬 모델(LM Studio) 첫 번째 경로 강조
**현재:** LM Studio 지원은 Provider 표 안에 숨겨져 있다.

**개선안:** Getting Started에 "No API key? Start here" 섹션 추가.

```markdown
## No API key? Try with a local model

Install [LM Studio](https://lmstudio.ai/) → Download any model → Enable local server

```bash
npm install -g @robota-sdk/agent-cli
robota  # Select "LM Studio" when prompted — no API key needed
````

````

**이유:** 신규 방문자의 첫 마찰 포인트는 API 키다. 이 장벽을 없애면 체험 전환율이 올라간다. LangChain도 이 전략으로 초기 채택을 가속했다.

**구현:** `content/getting-started/README.md` 편집. 1시간 작업.

---

### 개선안 12: Claude Code 호환성을 셀링포인트로 역전
**현재:** `.claude/` 설정 파일 지원이 "Claude Code compatibility layer"라고 조용히 언급되어 있다.

**문제:** 이는 오히려 강력한 셀링포인트다. Claude Code를 이미 사용 중인 팀이 마이그레이션 없이 Robota를 도입할 수 있다는 의미이기 때문이다.

**개선안:** README에 명시적으로 강조.

```markdown
## Claude Code Users: Drop-in Compatible

Already using Claude Code? Robota reads your existing `.claude/settings.json` and `.claude/agents/` without modification.

- Keep your existing agent definitions
- Add multi-provider support (OpenAI, Gemini, DeepSeek, local models)
- Self-host your own CLI
- No lock-in to Anthropic pricing
````

**구현:** `content/README.md`에 섹션 추가. 30분 작업.

---

## 5. 벤치마크 사례

### Stripe — 개발자 도구 랜딩 페이지의 교과서

- **첫 문장 원칙:** "Payments infrastructure for the internet" — 무엇인지, 누구를 위한지가 5단어 안에 전달.
- **3단계 Quick Start:** Copy-paste 가능한 코드 3줄로 첫 결제 요청 완성.
- **Live API Response:** 랜딩 페이지에서 실제 API 응답을 보여주는 interactive demo.
- **적용 포인트:** README Hero, 3줄 Quick Start, interactive demo.

### Vercel AI SDK (sdk.vercel.ai)

- **Use-case first 온보딩:** "What are you building? Chatbot / Agent / Generative UI" 선택 후 맞춤 가이드 제공.
- **Playground first:** 문서 상단에 interactive playground 링크 배치.
- **Provider 비교 테이블:** OpenAI, Anthropic, Google 등 제공자별 기능 차이를 테이블로 명시.
- **적용 포인트:** 결정 트리 온보딩, 플레이그라운드 강조, 프로바이더 비교.

### Linear — 개발자 신뢰 구축

- **"Built with Linear"** 사용 사례 로고 (Loom, Raycast 등 유명 팀 레퍼런스).
- **Product video 30초:** 텍스트 없이 제품이 어떻게 작동하는지 보여줌.
- **Changelog 공개:** 주 단위 업데이트 공개로 "살아있는 프로젝트" 신호 발신.
- **적용 포인트:** 사용 사례 언급, changelog/release notes 강화.

### LangChain — 오픈소스 AI SDK 온보딩

- **Python과 TypeScript 진입점 분리:** 언어별 완전히 다른 온보딩 제공.
- **"LangSmith in 5 minutes":** 핵심 차별점 하나를 5분 demo로 집중.
- **Community Discord 링크 노출:** 커뮤니티 신호를 문서 최상단에 배치.
- **적용 포인트:** 커뮤니티 채널 명시, 핵심 차별점 집중 demo.

### Bun — 개발자 첫인상 최적화

- **첫 화면이 설치 명령어:** 랜딩 페이지에 접속하면 첫 눈에 `curl -fsSL https://bun.sh/install | bash` 가 보임.
- **Benchmark 수치:** 구체적 숫자("3x faster than Node.js")로 가치 전달.
- **One-liner install:** 진입 장벽을 인간이 기억할 수 있는 수준으로 낮춤.
- **적용 포인트:** 설치 명령어를 첫 화면에 배치, 구체적 수치 추가.

---

## 6. 실행 로드맵 (3주)

### Week 1 — 문서 Quick Win (임팩트 High, 난이도 Easy)

- [ ] Hero Headline 교체 (개선안 1)
- [ ] 신뢰 신호 배지 추가 (개선안 5)
- [ ] macOS 경고 위치 이동 (개선안 7)
- [ ] 단일 CTA 강화 (개선안 10)
- [ ] Claude Code 호환성 셀링포인트화 (개선안 12)

**예상 소요:** 8시간 총합

### Week 2 — 온보딩 개선 (임팩트 High, 난이도 Medium)

- [ ] 경쟁 포지셔닝 테이블 추가 (개선안 2)
- [ ] 온보딩 결정 트리 추가 (개선안 3)
- [ ] 5분 Quick Win 경로 재정의 (개선안 4)
- [ ] 패키지 설치 가이드 재구성 (개선안 9)
- [ ] 로컬 모델 경로 강조 (개선안 11)

**예상 소요:** 12시간 총합

### Week 3 — 신뢰 구축 (임팩트 Mid, 다양한 난이도)

- [ ] 블로그 포스트 1편 (개선안 8)
- [ ] StackBlitz playground embed (개선안 6 옵션 A)
- [ ] 블로그 포스트 2편 (개선안 8)

**예상 소요:** 16시간 총합

---

## 7. 핵심 지표 추적 제안

개선 전후 효과를 측정하기 위해 다음 지표를 추적할 것을 권장한다:

| 지표                                    | 측정 방법                                  | 목표          |
| --------------------------------------- | ------------------------------------------ | ------------- |
| README → Getting Started 전환율         | GitHub 클릭 추적 (없으면 docs 트래픽 분석) | +30%          |
| Getting Started → 첫 코드 실행 시간     | Discord/GitHub issue 정성 조사             | 20분 → 5분    |
| npm @robota-sdk/agent-cli 주간 다운로드 | npmjs.com stats                            | +50% (4주 후) |
| GitHub star 증가 속도                   | star-history.com                           | 주 10+        |
| 블로그 → docs 전환율                    | analytics UTM                              | 측정 시작     |

---

_이 리포트는 2026-05-18 기준 공개 문서 분석을 바탕으로 작성되었습니다. 실제 사용자 인터뷰, 퍼널 애널리틱스 데이터, npm 다운로드 현황을 추가로 확보하면 우선순위를 더 정밀하게 조정할 수 있습니다._
