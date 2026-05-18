# Robota SDK 상품성 개선 종합 보고서

> 작성일: 2026-05-18  
> 분석 참여: 웹서비스 기획자 · CEO · 웹 디자이너 에이전트 3인 병렬 분석  
> 분석 대상: content/ (robota.io), apps/agent-web (플레이그라운드), apps/blog (블로그)

---

## 핵심 진단 요약

**3개 관점의 공통 결론: "기술은 완성, 상품은 시작 전"**

Robota SDK는 v3.0.0-beta.59 기준으로 멀티 프로바이더(8개), 완전한 TUI CLI, HTTP/WS/MCP 트랜스포트, 서브에이전트 런타임, 플러그인 시스템까지 갖춘 기술적으로 성숙한 프로젝트다. 그러나 이 기술이 외부 개발자에게 어떻게 전달되는지 — 즉 랜딩 페이지, 온보딩, 브랜드, 커뮤니티, 성장 전략 — 는 아직 구축되지 않았다.

---

## 1. 3개 관점 공통 발견

### 공통 문제 1: 포지셔닝 메시지 부재

현재 README 첫 문장: _"A TypeScript framework for building AI agents with multi-provider support, tool calling, and extensible plugin architecture."_

이것은 포지셔닝이 아니라 기능 목록이다. 세 에이전트 모두 이것을 최우선 문제로 지목했다.

**3인 제안 통합안:**

> "The open-source alternative to Claude Code. Multi-provider, TypeScript-native, self-hostable."

또는 더 짧게:

> "Build your own AI coding assistant. Any provider. Any project."

벤치마크: Supabase("The open source Firebase alternative"), Vercel("Deploy web projects in seconds")

---

### 공통 문제 2: 개발자 신뢰 신호 전무

| 신호                   | 현황           |
| ---------------------- | -------------- |
| npm 버전/다운로드 배지 | 없음           |
| GitHub Stars 배지      | 없음           |
| 활성 커밋 날짜 배지    | 없음           |
| 기업/팀 사용 사례      | 없음           |
| v1.0.0 안정 버전       | 없음 (beta.59) |

신규 방문 개발자가 "이게 살아있는 프로젝트인가?"를 판단할 근거가 없다.

---

### 공통 문제 3: 플레이그라운드 고립

`apps/agent-web/playground`는 존재하지만:

- robota.io 어디에도 링크 없음
- nav에 Playground 항목 없음
- Hero CTA에 "Try it" 없음
- WS 서버를 로컬에서 직접 실행해야 하는 개발자 전용 도구

가장 강력한 "체험"이 사용자 여정에서 완전히 단절됐다.

---

### 공통 문제 4: Claude Code 호환성이 묻혀 있음

`.claude/` 경로, CLAUDE.md, AGENTS.md 호환이 SDK에 구현되어 있지만 어디에도 마케팅 언어로 표현되지 않았다. 이것은 Claude Code 사용자를 직접 타겟할 수 있는 강력한 셀링포인트다.

---

## 2. 관점별 고유 발견

### 기획자 관점 (제품/사용자 여정)

- **AHA 모먼트 경로가 너무 길다** — API 키 없이 체험할 수 있는 LM Studio 경로가 온보딩에서 숨겨져 있다.
- **경쟁 포지셔닝 섹션 부재** — LangChain, Claude Code 대비 차별점이 문서 어디에도 없다.
- **온보딩 결정 트리 없음** — "CLI vs SDK vs createQuery" 중 무엇을 써야 하는지 신규 방문자가 알 수 없다.
- **macOS 경고 위치가 온보딩 첫 화면** — 부정적 첫인상.

### CEO 관점 (비즈니스/성장)

- **PLG funnel 전혀 없음** — 오픈소스 → 유료 전환 경로 미설계.
- **beta 영구화** — beta.59는 기업 채택 심리를 막는 라벨. v1.0.0 선언 계획 필요.
- **SEO 0** — "langchain typescript alternative", "claude code open source" 같은 검색어 순위 없음.
- **수익화 경로 미설계** — FUTURE-PROJECTS.md에 "$1M+ ARR"이 있지만 경로가 없다.
- **커뮤니티 씨앗 없음** — GitHub Discussions, Discord, CONTRIBUTING.md 모두 없음.

### 디자이너 관점 (UX/UI)

- **홈이 README 덤프** — `layout: home` 선언했지만 `hero`/`features` frontmatter가 없어 일반 텍스트로 렌더링됨.
- **브랜드 컬러 3분열** — 문서(파란색), Playground(바이올렛), 블로그(그린)가 제각각.
- **코드 예제 탭 전환 없음** — Provider별 코드가 탭 없이 순차 나열됨.
- **사이드바 자동 생성** — 수동 정보 계층 없어 초보자 여정 설계 불가.
- **ASCII 아키텍처 다이어그램** — Mermaid 시각화로 교체 필요.

---

## 3. 통합 우선순위 매트릭스

| ID   | 개선안                                             | 임팩트 | 난이도 | Phase | 담당        |
| ---- | -------------------------------------------------- | ------ | ------ | ----- | ----------- |
| W-01 | Hero 포지셔닝 + VitePress Hero frontmatter         | High   | Easy   | 1     | 문서+디자인 |
| W-02 | npm/GitHub 신뢰 신호 배지                          | High   | Easy   | 1     | 문서        |
| W-03 | nav + Hero CTA에 Playground 링크 추가              | High   | Easy   | 1     | 디자인      |
| W-04 | 다크모드 브랜드 컬러 토큰 교체                     | Mid    | Easy   | 1     | 디자인      |
| W-05 | 모바일 코드 블록 CSS                               | Mid    | Easy   | 1     | 디자인      |
| W-06 | 경쟁 포지셔닝 섹션 + Claude Code 호환성 셀링포인트 | High   | Easy   | 1     | 문서        |
| W-07 | macOS 경고 Troubleshooting으로 이동                | Mid    | Easy   | 1     | 문서        |
| W-08 | 온보딩 결정 트리 (Use-Case Selector)               | High   | Medium | 2     | 문서+디자인 |
| W-09 | 패키지 설치 가이드 재구성 (목적별)                 | High   | Medium | 2     | 문서        |
| W-10 | 브랜드 컬러 통합 (3개 앱 동기화)                   | High   | Medium | 2     | 디자인      |
| W-11 | 코드 탭 전환 컴포넌트 (Provider별)                 | High   | Medium | 2     | 디자인      |
| W-12 | 사이드바 수동 정보 계층화                          | High   | Easy   | 2     | 디자인      |
| W-13 | Playground 온보딩/에러 상태 UI                     | High   | Medium | 3     | 개발        |
| W-14 | 아키텍처 Mermaid 다이어그램                        | Mid    | Medium | 3     | 문서        |
| W-15 | 인터랙티브 Quick Start 스텝 컴포넌트               | High   | Hard   | 3     | 개발        |
| M-01 | GitHub Discussions 개설 + CONTRIBUTING.md          | Mid    | Easy   | 1     | 커뮤니티    |
| M-02 | 블로그 런치 콘텐츠 3편 (HN/Reddit 타겟)            | High   | Medium | 2     | 콘텐츠      |
| M-03 | v1.0.0 선언 계획 + 체크리스트 수립                 | High   | Medium | 2     | 제품        |
| M-04 | SEO — og:description, sitemap, 키워드 전략         | Mid    | Medium | 2     | 마케팅      |
| M-05 | 공개 로드맵 페이지 (robota.io/roadmap)             | Low    | Easy   | 3     | 제품        |
| P-01 | 퍼블릭 플레이그라운드 (호스팅 데모)                | High   | Hard   | 3     | 개발        |
| P-02 | Robota Cloud 수익화 실험 (BYOK 무료 → 팀 유료)     | High   | Hard   | 4     | 사업        |

---

## 4. Phase별 실행 계획

### Phase 1 — 빠른 Win (1~3일, 코드 변경 최소)

**목표:** 랜딩 첫인상과 신뢰 신호를 즉시 개선

- W-01: Hero frontmatter + 포지셔닝 문장 교체 → `content/README.md`
- W-02: npm/GitHub 배지 추가 → `content/README.md`
- W-03: Playground 링크 → VitePress nav + Hero CTA
- W-04: 다크모드 컬러 토큰 → `apps/docs/.vitepress/theme/style.css`
- W-05: 모바일 CSS → 동일 파일
- W-06: 경쟁 포지셔닝 테이블 + Claude Code 호환 섹션 → `content/README.md`
- W-07: macOS 경고 이동 → `content/getting-started/README.md`
- M-01: GitHub Discussions 개설 (GitHub UI)

**예상 효과:** 랜딩 전환율 개선, 신뢰 신호 추가, SEO 개선

---

### Phase 2 — 구조 개선 (1~2주)

**목표:** 온보딩 퍼널과 문서 구조 개선

- W-08: 결정 트리 + 로컬 모델 첫 번째 경로 → `content/getting-started/README.md`
- W-09: 패키지 설치 가이드 재구성 → `content/README.md`
- W-10: 브랜드 컬러 통합 → VitePress style.css + blog globals.css
- W-11: 코드 탭 컴포넌트 → VitePress 커스텀 컴포넌트
- W-12: 사이드바 수동 계층화 → VitePress config
- M-02: 블로그 포스트 1~2편 (Hacker News 타겟)
- M-03: v1.0.0 체크리스트 수립
- M-04: SEO 메타 + sitemap 정비

---

### Phase 3 — 인터랙티브 경험 (2~4주)

**목표:** 실제 체험 경로 구축

- W-13: Playground 온보딩/에러 UI → `apps/agent-web`
- W-14: Mermaid 다이어그램 → `content/guide/architecture.md`
- W-15: 인터랙티브 Quick Start 스텝 컴포넌트
- M-05: 공개 로드맵 페이지
- P-01: 퍼블릭 플레이그라운드 (API 키 입력 → 즉시 체험)

---

### Phase 4 — 수익화 (3개월+)

- P-02: Robota Cloud 수익화 실험
  - 무료 BYOK → 팀 공유 세션/대시보드 유료 → 엔터프라이즈 온프레미스
  - 벤치마크: Supabase / Hashicorp / Vercel 오픈소스 → 호스팅 모델

---

## 5. 즉시 실행 가능한 "오늘 8시간" 목록

1. `content/README.md` — Hero 문장 교체 + 배지 추가 + 경쟁 포지셔닝 테이블 + CC 호환 섹션 + 설치 가이드 재구성 (3h)
2. `apps/docs/.vitepress/theme/style.css` — 브랜드 컬러 + 다크모드 토큰 + 모바일 CSS (1h)
3. VitePress nav config — Playground 링크 추가 (30m)
4. `content/getting-started/README.md` — macOS 경고 이동 + 결정 트리 추가 (1.5h)
5. GitHub Discussions 개설 (15m)

---

## 6. 핵심 메시지 (3인 공통 결론)

> Robota는 이미 Claude Code를 대체할 수 있는 기술을 가졌다.  
> 지금 필요한 것은 코드가 아니라 이야기(narrative)와 진입로(funnel)다.

가장 강력한 포지셔닝 공식:
**"Claude Code처럼 작동하지만, 어떤 AI 프로바이더도 쓸 수 있고, 오픈소스이며, 당신의 제품에 내장할 수 있다."**

---

_이 보고서는 2026-05-18 기준 웹서비스 기획자·CEO·웹 디자이너 관점의 병렬 분석을 종합한 것입니다._
