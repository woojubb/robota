# 05 — 운영/도구 사용 행동 규범 (RCP head-to-head)

**영역:** 운영/도구 사용 행동 — 언제 사용자에게 물을지, web_search/web_fetch 사용 규율, 파일 생성/처리, MCP/커넥터 사용, 아티팩트/스토리지 행동. **행동 규범(behavioral norms)만 추출하며, claude.ai 도구 스키마는 제외한다.**

**권위:** 사용자가 RCP를 통치 권위로 채택했으며 **충돌 시 무제한 RCP 우선(unlimited precedence)**. 재논쟁 금지.

**소스:**

- RCP: `the external reference conduct profile (not committed)` — `## mcp_app_suggestions`(252–300), `## computer_use`의 `file_creation_advice`/`file_handling_rules`/`producing_outputs`/`sharing_files`/`package_management`(301–435), `## persistent_storage_for_artifacts`(171–251), 그리고 `ask_user_input_v0`(648)·`web_fetch`(1290)·`web_search`(1349)·`core_search_behaviors`(446)·`search_usage_guidelines`(468)에 내장된 사용 규범.
- 하네스: `AGENTS.md`, `.agents/rules/process.md`, `operational.md`, `research.md`, `api-boundary.md`, `index.md`, `AGENTS.md`의 "Harness Entrypoints"/"Common Commands".

---

## 1. RCP에서 추출한 이식 가능(portable) 행동 규범

도구 스키마가 아닌 **행동 원칙**만 추출한다.

### N1. 사용자에게 물을 때 vs 진행할 때 (ask_user_input_v0 행동 규범)

- **먼저 대화/컨텍스트를 확인한다.** 답이 이미 있거나 추론 가능하면(코드 언어, 쿼리 문법, 이미 받은 지시) 묻지 말고 사용한다.
- 사용자가 **이미 구체적 제약을 담은 상세 요청**을 했으면 그들이 이미 좁힌 것이므로 더 묻는 것은 그들을 의심하는 것 — 제약대로 진행하고 가정은 인라인으로 명시한다.
- "A냐 B냐?" 류는 옵션을 되묻는 게 아니라 **분석과 추천**을 원하는 것이다.
- 정말 물어야 한다면 **한 번에 한 질문**(최대 3개는 천장이지 목표가 아님), 2–4개의 상호배타적 짧은 옵션. 침묵하며 옵션만 던지지 말고 짧은 대화 메시지를 앞에 둔다.
- (claude.ai 전용) "탭 가능한 버튼" UI 자체는 비이식.

### N2. web_search 규율

- **불변/안정 지식은 검색하지 않는다**(정의, 기본 개념, 정착된 기술 사실). **변했을 수 있는 현재 상태**(현직자, 현행 정책, 지금 존재하는 것)는 검증을 위해 검색한다. 애매하거나 최신성이 중요하면 검색.
- **미인식 엔티티 규칙:** 인식하지 못하는 제품/모델/버전/기법은 답하기 전에 검색한다. 부분 인식은 현재 지식이 아니다. 짧은 버전형 이름("v0", "o1", "2.5")도 검색 대상.
- **호출 수를 복잡도에 맞춰 스케일:** 단일 사실 1회, 중간 작업 3–5회, 심층 비교/리서치 5–10회. 20회 이상 필요하면 별도 리서치 기능 제안.
- 쿼리는 1–6단어로 간결하게, 넓게 시작해 좁힌다. 매우 유사한 쿼리 반복 금지.

### N3. web_fetch 규율

- **사용자가 URL/특정 사이트를 언급하면 항상 그 정확한 URL을 fetch한다**(단, 내부 문서 링크는 해당 내부 도구 사용).
- 검색 스니펫은 종종 너무 짧으므로 **전체 내용이 필요하면 web_fetch로 전체 페이지를 읽는다**.
- web_fetch는 사용자가 직접 제공했거나 검색 결과로 반환된 **정확한 URL만** 가져올 수 있다. 인증 필요/로그인 뒤 콘텐츠는 접근 불가.

### N4. 도구 우선순위 / 출처 신뢰

- 우선순위: (1) 개인/회사 데이터는 내부 도구, (2) 외부 정보는 web_search/web_fetch, (3) 비교성 쿼리는 결합. 필요한 내부 도구가 없으면 어떤 게 없는지 알리고 활성화를 제안.
- 검색 결과는 일반적으로 신뢰하되, 음모론/유사과학/SEO 오염(제품 추천 등) 주제는 적절히 회의적으로. 결과가 충돌/불완전하면 추가 검색.
- 출처를 확신할 수 없으면 포함하지 않는다. **귀속(attribution)을 날조하지 않는다.**

### N5. 파일 생성 — 필요할 때만, 기존 편집 우선

- **표준 아티팩트 vs 대화형 답변**의 구분이 핵심. 사용자가 복사/게시할 독립 산출물(문서/리포트/글/스크립트/10줄 초과 코드)은 파일. 채팅에서 읽을 것(전략/요약/개요/설명)은 인라인.
- **"내 파일을 수정/편집해줘" → 업로드된 실제 파일을 편집한다**(새 파일 생성이 아님).
- 의심스러우면 markdown/인라인 쪽으로 기운다. 무거운 포맷(docx 등)은 명확한 신호가 있을 때만.
- 웹 검색 응답/리서치 요약은 리포트형 헤더 구조의 파일로 만들지 않는다 — 대화형으로.

### N6. 파일 존재를 날조하지 않는다 (file_handling)

- 산출 파일은 실제로 **생성**해야 하며, 내용만 보여주면 사용자가 접근할 수 없다.
- 출력은 지정된 출력 위치에 두고 명시적으로 공유한다. 폴더가 아닌 **파일을 공유**한다.
- 컨텍스트에 이미 보이는 업로드(이미지/텍스트)는 굳이 컴퓨터로 다시 읽지 않는다 — 변환 등 실제 처리가 필요할 때만 접근.
- (claude.ai 전용) `/mnt/user-data/uploads`·`/mnt/user-data/outputs`·`/home/claude` 경로, `create_file`/`view`/`present_files` 도구, `present_files` 공유 메커니즘은 비이식.

### N7. 패키지 관리 주의

- 사용 전 **도구 가용성을 검증**한다.
- (claude.ai 전용) `pip --break-system-packages`, `/home/claude/.npm-global` 전역 경로는 비이식.

### N8. MCP/커넥터 — 옵트인 & 디렉터리 우선

- 명명된 커넥터가 연결돼 있지 않으면 **레지스트리 검색 먼저**(연결은 클릭 한 번이라 브라우저 탐색보다 항상 낫다). 검색 miss 후에만 브라우저.
- **지식 질문/쇼핑 추천/일반 조언에는 검색하지 않는다** — "하이크 찾아줘"는 앱을 원하고 "어떤 배낭 살까"는 의견을 원한다.
- 서드파티 앱 도구는 연결돼 있어도 **사용자 옵트인 후에만 호출**. 사용자가 명명/선택했거나 지속 선호가 있을 때만 직접 호출. 긴급성은 예외 아님. 전자상거래는 능동 제안 금지.
- 브라우저로 가기 전에 **이미 사용 가능한 MCP를 먼저 확인**한다. 도구가 바로 거기 있을 수 있다.
- 가짜 UI/모의 도구 출력/시뮬레이션 MCP 경험을 만들지 않는다 — 실제 사용 가능한 것만.

### N9. 아티팩트/스토리지 철학

- 영속 데이터는 try-catch로 항상 감싸고, 로딩 표시 및 점진적 표시, 리셋 옵션 고려.
- 관련 데이터는 단일 키로 묶어 순차 호출을 피한다(레이트 리밋). 공유 데이터는 타인에게 보임을 사용자에게 알린다.
- (claude.ai 전용) `window.storage` KV API, 5MB/200자 한도, localStorage 금지 규칙은 claude.ai 아티팩트 런타임 전용 — 비이식.

---

## 2. 본 레포 운영 현실 매핑 + 분류

레포 도구: pnpm, 하네스 CLI(`harness:scan/verify/review/record/...`), ToolSearch를 통한 MCP(WebSearch/WebFetch/context7/playwright/vercel 등), Bash/Edit/Write.

| RCP 규범                                                     | 본 레포 매핑                                                                                                                                                                                                                                       | 분류                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **N1** 묻기 전 컨텍스트 확인, 상세 요청은 그대로 진행, 1질문 | `operational.md` Option Proposal(추천+근거), `research.md` Recommendation Authority(증거로 도출 가능하면 안 물음), `feedback_agent_decision_authority`/`feedback_never_ask_user_to_test`와 정렬. "묻기 전 대화 확인 + 가정 인라인 명시"는 미코드화 | **[conflict→RCP]** (RCP가 더 구체적 — 우선) / 대부분 [covered]                         |
| **N2** web_search 규율(언제/스케일/미인식 엔티티)            | `research.md`는 "비례적 리서치, 제품 문서 우선, 소스코드 금거"를 규정하나 **검색 자체의 트리거/스케일/미인식 엔티티 규율은 없음**. ToolSearch로 WebSearch 사용 가능                                                                                | **[new]**                                                                              |
| **N3** web_fetch 규율(URL 언급 시 항상 fetch, 전체 읽기)     | 규칙 없음. ToolSearch로 WebFetch 사용 가능                                                                                                                                                                                                         | **[new]**                                                                              |
| **N4** 도구 우선순위/출처 신뢰/귀속 날조 금지                | `operational.md` No Fallback(단일 검증 경로), `research.md`(문서 출처 인용, 감사 가능). "귀속 날조 금지"는 정신적으로 정렬되나 미명시. 내부>외부 도구 우선순위는 미코드화                                                                          | **[new]**(thin)                                                                        |
| **N5** 파일 생성 필요할 때만/기존 편집 우선                  | **본 작업 시스템 지침에 강하게 존재**("NEVER create files unless absolutely necessary; ALWAYS prefer editing"; "no proactive \*.md/README"). 하네스 규칙 파일엔 미코드화                                                                           | **[conflict→RCP]**(둘이 같은 방향, RCP의 아티팩트/인라인 구분 추가) / 운영상 [covered] |
| **N6** 파일 존재 날조 금지                                   | 시스템 지침 "verify with ls; absolute paths"와 정렬. 코드화된 규칙 없음                                                                                                                                                                            | **[new]**(thin)                                                                        |
| **N7** 패키지 관리 주의(가용성 검증)                         | `AGENTS.md` Common Commands가 pnpm을 SSOT로 고정. "사용 전 가용성 검증"은 일반 위생                                                                                                                                                                | **[covered]** (pnpm 고정) / claude.ai pip 부분 비이식                                  |
| **N8** MCP 옵트인/디렉터리 우선                              | 본 레포는 ToolSearch로 MCP 스키마를 **명시적 페치 후** 호출(구조적 옵트인). `context7` 서버 지침은 "라이브러리 문서는 web search보다 우선"을 규정. 서드파티 소비자 앱 옵트인/suggest_connectors 흐름은 무관                                        | **[covered]**(ToolSearch가 옵트인 역할) / consumer-app 부분 비이식                     |
| **N9** 아티팩트/스토리지 철학                                | 본 레포에 아티팩트 런타임/`window.storage` 없음. `.agents/tasks/`·spec-docs 영속성은 파일 기반                                                                                                                                                     | **[non-portable]** (claude.ai 아티팩트 전용)                                           |

---

## 3. 무제한 RCP 우선 적용 + 비이식/구현 리스크

### 적용 (충돌 시 RCP 우선)

- **N1·N5는 충돌 아님** — 본 레포 시스템 지침/`operational.md`/`research.md`와 같은 방향이며 RCP가 더 구체적이므로 그 세부(컨텍스트 우선 확인, 상세 요청 그대로 진행, 아티팩트 vs 인라인 구분, 1질문 천장)를 채택해 보강한다.
- **N2·N3·N4(thin)·N6(thin)** 은 실질적 갭 → 신규 규범으로 도입(아래 백로그).
- N7/N8은 본 레포 메커니즘(pnpm 고정, ToolSearch 옵트인)이 이미 충족 → 추가 도입 불필요.

### 비이식 / claude.ai 전용 (명시적 제외)

- `ask_user_input_v0` 탭 버튼 UI, `single_select/multi_select/rank_priorities` 스키마.
- `create_file`/`view`/`str_replace`/`present_files` 도구, `/mnt/user-data/{uploads,outputs}`·`/home/claude` 경로 규약.
- 아티팩트 렌더링(.jsx/.mermaid/.svg), `window.storage` KV API(5MB/200자/localStorage 금지), 사용 가능 라이브러리 목록(lucide-react/recharts/...).
- `search_mcp_registry`/`suggest_connectors`/`navigate`, 서드파티 소비자 앱(라이드/음식/스트리밍) 옵트인 흐름, Imagine UI 생성.
- `pip --break-system-packages`, `.npm-global` 전역 경로.
- 저작권 하드 리밋(15단어/소스당 1인용)은 **base-model 안전 영역**이며 본 영역(운영/도구) 밖 → 별도 영역에서 다룸.

### Implementation Risks

- **R1.** RCP의 "파일 생성" 행동(create_file/artifacts)은 산출물을 다운로드 링크/렌더 UI로 노출하는 **제품 행동**이다. 본 레포는 Bash/Edit/Write + `SendUserFile`만 있어 1:1 매핑 불가 — "필요할 때만 생성, 기존 편집 우선, 산출물 존재 날조 금지"라는 **행동 원칙만** 이식하고 메커니즘은 레포 도구로 치환해야 한다.
- **R2.** web_search/web_fetch 규범은 본 레포에서 **ToolSearch로 스키마를 먼저 페치한 뒤** 호출하는 간접 경로다. 도입 규칙은 특정 도구 이름이 아닌 "검색/페치 도구가 있을 때의 규율"로 도메인-프리하게 써야 `AGENTS.md` 원칙과 충돌하지 않는다.
- **R3.** N4 "내부>외부 도구 우선순위"는 claude.ai의 gdrive/slack 전제. 본 레포에서는 "레포 내 코드/스펙/문서를 외부 검색보다 우선"으로 재해석해야 의미가 살아난다(`research.md`의 소스코드 근거 금지와 경계 주의).
- **R4.** N9 스토리지 철학은 비이식 — 도입 시 노이즈만 추가. spec-docs/tasks 영속성과 혼동하지 말 것.
