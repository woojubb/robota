# 비교 페이지 검토 (apps/www compare)

검토 대상:

- 컴포넌트: `apps/www/src/app/[locale]/compare/page.tsx`
- 카피: `apps/www/src/messages/en.json` / `ko.json`의 `compare` 키 (89~148행)

## 요약

이 페이지의 가장 큰 문제는 **AGPL-3.0를 경쟁 우위(장점)로 포장한 것**이다. AGPL-3.0은 카피레프트 + 네트워크 소스 공개 의무를 가진 라이선스 *선택*일 뿐, 그 자체로 경쟁 우위가 아니며 상업 사용자 다수에게는 MIT/허용형 대비 오히려 **단점**이다. 현재 카피는 (1) 페이지 description 헤드라인, (2) 기능 비교표의 "Open source (AGPL-3.0)" 체크 항목, (3) 차별점 카드 "3. Fully Open Source (AGPL-3.0)" 세 곳에서 AGPL을 셀링포인트로 제시한다. 실제 사용자 가치는 "감사 가능 / 자체 호스팅 / 벤더 락인 없음"이며, AGPL 라이선스는 중립적 사실로(상업 라이선스 옵션과 함께) 표기해야 한다.

그 외에 (a) "The only AI coding CLI that…" / "No other AI coding assistant exposes this" 같은 **검증 불가능한 절대 주장**, (b) 기능 비교표의 일부 부정확/오해 소지 항목, (c) 다소 과장된 톤, (d) 한글 번역의 어색함(translationese)이 P0~P2로 발견되었다.

전반적으로 카피의 "유치함"보다 더 심각한 launch 리스크는 **공정성/정확성**(AGPL 과장 + 절대 주장)이다. AGPL 관련 P0 3건을 최우선으로 수정 권고한다.

## AGPL을 장점으로 표현한 문제 (PRIMARY — 가장 자세히)

### 문제의 본질

AGPL-3.0는 다음 의무를 부과하는 강한 카피레프트 라이선스다:

- **소스 공개 의무**: 파생 저작물 배포 시 전체 소스를 동일 라이선스로 공개.
- **네트워크 사용 조항(Section 13)**: 네트워크 너머로 SaaS 형태로 제공만 해도 사용자에게 _수정된_ 소스 코드를 제공해야 함 — 이것이 GPL과 결정적으로 다른 점.

이 때문에 상업 SaaS 사업자·내부 폐쇄 제품에 임베드하려는 기업에게 AGPL은 **채택 장벽**이다. 그래서 이 프로젝트도 commercial 라이선스를 별도 제공한다. 즉 AGPL은 "경쟁사보다 우월한 기능"이 아니라, **선택지(오픈소스 or 상업 라이선스)를 만드는 중립적 사실**이다.

사용자에게 실제로 가치를 주는 것은 라이선스 약어가 아니라 그 *결과*다:

- 전체 소스를 **감사(auditable)** 할 수 있다.
- **자체 호스팅(self-host)** 할 수 있다.
- **벤더 락인이 없다** — 회사가 망해도 코드가 남는다.
- 상업적으로 쓰고 싶으면 **상업 라이선스 경로**가 있다.

따라서 카피는 "AGPL이라서 좋다"가 아니라 "오픈소스라 감사·자체호스팅·락인 없음이 가능하고, 상업용도 상업 라이선스로 커버된다"로 reframe 해야 한다. AGPL 약어는 사실 표기 수준(괄호/각주)으로 내리는 것이 정확하고 공정하다.

### 위치별 진단

**1) `compare.description` (en.json:91 / ko.json:91) — 헤드라인에서 AGPL을 셀링포인트로**
현재: "...embed the same engine into your own app — **open source under the AGPL-3.0**, with a commercial license available."

- 페이지 최상단 헤드라인에서 "AGPL-3.0 오픈소스"를 핵심 차별점처럼 내세운다. 헤드라인 가치는 "BYOK / 오프라인 로컬 / 임베드"여야 하고, 라이선스는 부가 사실이다. → P0 (아래 표 참조)

**2) 기능 비교표 항목 `features[4]` "Open source (AGPL-3.0)" (en.json:98 / ko.json:98)**

- 비교표는 "기능"을 비교하는 표인데 라이선스를 하나의 우위 기능처럼 행으로 넣었다. 게다가 `FEATURE_ROW_DATA[4]`를 보면 Aider(Apache 2)·Cline도 ✓다 — 즉 **이 행에서는 Robota가 이기지도 않는다.** "오픈소스"가 우위라는 인상을 주지만 실제 표 데이터는 동률이고, 라이선스 종류(AGPL vs Apache 2)는 오히려 Robota 쪽이 상업 사용자에게 더 제약적이다. 행 자체는 "Open source" 정도로 두되 라이선스 약어는 각주로 내리고, "License"는 별도 정보행으로 분리 권고. → P0

**3) 차별점 카드 `differentiators.items[2]` "3. Fully Open Source (AGPL-3.0)" (en.json:117-118 / ko.json:117-118)**
현재 title: "3. Fully Open Source (AGPL-3.0)", body: "Every line is publicly auditable. Fork it, modify it, self-host it, build commercial products — no CLA required."

- "차별점(What Makes Robota Different)" 섹션에 AGPL을 명시한 카드를 둔 것 자체가 "AGPL = 차별적 우위" 프레이밍이다. body의 "build commercial products"는 특히 오해 소지가 크다 — AGPL 하에서 상업 제품을 만들면 소스 공개/네트워크 조항 의무가 따르며, 의무 없이 쓰려면 상업 라이선스가 필요하다. 현재 문구는 "AGPL인데 상업 제품 자유롭게 가능"으로 읽혀 **법적으로 오해 소지(P0)**. title에서 라이선스 약어를 빼고 "Open & Self-Hostable"류로 바꾸고, body는 감사/자체호스팅 가치 + "상업 사용은 상업 라이선스" 명시로 정정 권고. → P0

## 발견 사항

| 심각도 | 위치 (file:key)                                | 현재 문구                                                                                                                                               | 문제                                                                                                                                                                                                                                               | 제안 수정안 (EN / KO)                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | en/ko.json:91 `compare.description`            | "...— open source under the AGPL-3.0, with a commercial license available."                                                                             | 헤드라인에서 AGPL을 셀링포인트로 제시. 라이선스는 중립 사실이어야 함. 또한 "The only AI coding CLI that…" 절대 주장 포함(아래 별도 P0와 연동).                                                                                                     | EN: "...embed the same engine into your own app. Source-available and self-hostable, with both an open-source (AGPL-3.0) and a commercial license." / KO: "...동일한 엔진을 자신의 앱에 임베드할 수 있습니다. 전체 소스가 공개되어 자체 호스팅이 가능하며, 오픈소스(AGPL-3.0)와 상업용 라이선스를 모두 제공합니다."                                                                                                                                                    |
| **P0** | en/ko.json:98 `features[4]`                    | "Open source (AGPL-3.0)" / "오픈소스 (AGPL-3.0)"                                                                                                        | 라이선스를 우위 기능 행으로 표기. 실제 표 데이터(`FEATURE_ROW_DATA[4]`)는 Aider(Apache 2)·Cline도 ✓라 동률이며, AGPL은 상업 사용자에게 더 제약적임에도 "우위"로 보임.                                                                              | EN: 행 라벨 "Source-available", 라이선스 약어는 셀 각주로 (Robota: AGPL-3.0 / Commercial, Aider: Apache 2). / KO: "소스 공개", 약어는 각주(Robota: AGPL-3.0 / 상업용, Aider: Apache 2).                                                                                                                                                                                                                                                                                |
| **P0** | en/ko.json:117-118 `differentiators.items[2]`  | "3. Fully Open Source (AGPL-3.0)" — "...self-host it, build commercial products — no CLA required."                                                     | "차별점"으로 AGPL 제시 + "build commercial products" 문구가 AGPL 의무(소스 공개·네트워크 조항)를 가린 오해 소지.                                                                                                                                   | EN title: "3. Open & Self-Hostable" / body: "Every line is publicly auditable — fork it, modify it, and self-host with no vendor lock-in. Open-source use is AGPL-3.0; a commercial license is available for proprietary or SaaS use." KO title: "3. 공개 소스 · 자체 호스팅" / body: "모든 코드를 공개적으로 감사할 수 있습니다. 포크·수정·자체 호스팅이 가능하고 벤더 락인이 없습니다. 오픈소스 사용은 AGPL-3.0이며, 독점·SaaS 용도에는 상업 라이선스를 제공합니다." |
| **P0** | en/ko.json:91 `compare.description`            | "The only AI coding CLI that lets you bring your own key for any provider, run offline with a local model, and embed the same engine into your own app" | "The only…" 절대 주장. BYOK·로컬·임베드를 한 번에 하는 CLI가 *유일*하다는 것은 검증 불가/반증 가능(예: 다른 OSS 에이전트 프레임워크). launch 시 과장 클레임 리스크.                                                                                | EN: "A multi-provider AI coding CLI that lets you bring your own key for any provider, run fully offline with a local model, and embed the same engine into your own app." / KO: "어떤 프로바이더든 본인의 키를 사용하고, 로컬 모델로 완전히 오프라인 실행하며, 동일한 엔진을 자신의 앱에 임베드할 수 있는 멀티 프로바이더 AI 코딩 CLI."                                                                                                                               |
| **P0** | en/ko.json:114 `differentiators.items[1].body` | "No other AI coding assistant exposes this — Claude Code, Cursor, and Cline are closed products."                                                       | 절대 주장 + 부정확. 다른 OSS 에이전트 프레임워크(LangChain, Aider 라이브러리 사용 등)도 런타임을 임베드 형태로 노출한다. 또한 같은 표에서 Aider는 오픈소스로 표기됨 — "no other exposes" 와 모순. 특정 3사 콕집어 "closed"라 단정하면 공정성 시비. | EN: "Few AI coding assistants ship their agent runtime as an embeddable library — most (Claude Code, Cursor, Cline) are delivered only as end-user products." / KO: "에이전트 런타임을 임베드 가능한 라이브러리로 제공하는 AI 코딩 어시스턴트는 드뭅니다 — 대부분(Claude Code, Cursor, Cline)은 최종 사용자 제품으로만 제공됩니다."                                                                                                                                    |
| **P1** | en/ko.json:90 `compare.title`                  | "Why Robota?" / "왜 Robota인가?"                                                                                                                        | 톤 자체는 무난하나, 비교 페이지 제목으로는 약함. (선택적)                                                                                                                                                                                          | EN: "Robota vs. the alternatives" (유지 가능) / KO: "Robota와 다른 도구 비교" (또는 현행 유지). 우선순위 낮음.                                                                                                                                                                                                                                                                                                                                                         |
| **P1** | en/ko.json:122 `differentiators.items[3].body` | "Your code and prompts never leave your machine." / "코드와 프롬프트가 절대 외부로 나가지 않습니다."                                                    | "절대(never)" 단정. 로컬 모델 사용 시에만 참이며, 사용자가 클라우드 프로바이더로 전환하면 거짓. 조건 명시 필요.                                                                                                                                    | EN: "When you point Robota at a local model, your code and prompts stay on your machine." / KO: "Robota를 로컬 모델로 연결하면 코드와 프롬프트가 머신을 벗어나지 않습니다."                                                                                                                                                                                                                                                                                            |
| **P1** | en/ko.json:118 `differentiators.items[2].body` | "no CLA required" / "CLA 불필요"                                                                                                                        | 비전문 사용자에게 의미 불명확하고, 차별점으로서 약함. 기여 정책이지 사용자 가치 아님.                                                                                                                                                              | 제거하거나 contributing 문서로 이동. (위 P0 재작성안에 이미 반영해 삭제)                                                                                                                                                                                                                                                                                                                                                                                               |
| **P2** | page.tsx:88 (하드코딩)                         | 표 헤더 `<th>Feature</th>` 하드코딩(영문)                                                                                                               | i18n 누락 — 한글 로케일에서도 "Feature"로 노출. `featureComparison`은 번역되는데 표 헤더는 안 됨.                                                                                                                                                  | `t('featureColumnHeader')` 키 추가. EN: "Feature" / KO: "기능".                                                                                                                                                                                                                                                                                                                                                                                                        |
| **P2** | page.tsx:11,21-25,32 (하드코딩 note)           | `'subscription'`, `'proprietary'`, `'IDE only'`, `'Apache 2'`, `'Python'` 등 셀 각주가 컴포넌트에 하드코딩                                              | i18n 누락 + 카피 리뷰 범위 밖에서 관리됨. 한글 로케일에서 영문 노출.                                                                                                                                                                               | 각주 문자열을 메시지 키로 이동. 특히 "Apache 2"는 라이선스 표기 reframe과 함께 정리.                                                                                                                                                                                                                                                                                                                                                                                   |
| **P2** | en.json:147 / ko.json:147 `tryButton`          | "Try Robota now →" / "지금 Robota 사용해보기 →"                                                                                                         | 과한 느낌표/긴급성은 없으나 "now"는 가벼운 over-hype. 경미.                                                                                                                                                                                        | EN: "Get started →" / KO: "시작하기 →" (선택).                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 경쟁사 비교 정확성/공정성

**기능 비교표 (`FEATURE_ROW_DATA` ↔ `features`) 행별 점검:**

- `features[1]` "BYOK — no subscription required" ↔ row1: Claude Code ✓, cursorNote 'subscription'. Claude Code도 API 키(BYOK) 사용 가능하나 구독 모델이 주력이므로 ✓ 표기는 방어 가능. **단 "no subscription required"라는 라벨에 Claude Code가 ✓인 것은 미묘** — Claude Code는 사실상 구독/Max 플랜 중심. 라벨과 체크가 약하게 충돌. (P1 수준 정확성 이슈)
- `features[4]` "Open source" ↔ row4: Aider 'Apache 2' ✓, Cline ✓. 정확하나, 위 P0대로 "우위 기능"으로 보이게 한 게 문제.
- `features[5]` "TypeScript-first" ↔ row5: Claude Code ✓, Cursor ✓, aiderNote 'Python', Cline ✓. Aider가 Python인 건 정확. 다만 "TypeScript-first"가 Claude Code/Cursor에 ✓인 근거가 불명확(둘 다 사용자에게 TS를 강제하지 않음 — 이 행의 의미가 모호). 의미 재정의 필요. (P1)
- `features[8]` "Background agents" ↔ row8: Claude Code ✓, Cursor ✓. Cursor의 background agents는 맞음. 방어 가능.

**"When to Choose Something Else" 섹션 — 공정성은 양호:**

- Claude Code: "tightest Claude integration, Anthropic-only" — 정확하고 공정.
- Cursor: "IDE-first, inline diff, tab completion" — 정확.
- Aider: "Python ecosystem, git-based batch commits" — 대체로 정확. ("batch" 표현은 약간 단순화이나 오해 소지 적음.)
- Cline: "VSCode sidebar agent" — 정확.
- 이 섹션은 전반적으로 균형 잡혀 있고 공정함. **유지 권장.** 오히려 이 섹션의 공정한 톤을 차별점/헤드라인 섹션에도 적용해야 함.

**핵심 공정성 리스크:** 정작 differentiators 카드 #2의 "No other AI coding assistant exposes this … are closed products" 단정과, 표에서 AGPL을 우위로 보이게 한 부분이 위 공정한 섹션과 톤이 충돌한다. P0 수정으로 일관성 확보 필요.

## EN↔KO 정합성 이슈

- **description (91행)**: KO "—모두 AGPL-3.0 오픈소스 라이선스(상업용 라이선스 별도 제공) 하에."의 "하에."는 직역투(translationese). 문장이 "—" 뒤에 명사구로 끝나 어색. EN 재작성안에 맞춰 완결된 문장으로: "...오픈소스(AGPL-3.0)와 상업용 라이선스를 모두 제공합니다." (P1)
- **differentiators[1].body (114행)**: KO "다른 AI 코딩 어시스턴트는 이를 제공하지 않습니다 — Claude Code, Cursor, Cline은 모두 클로즈드 제품입니다." → EN의 절대 주장과 1:1 직역. EN 수정(Few/most)에 맞춰 KO도 완화 동기화 필요. "클로즈드 제품"은 그대로 두되 단정 톤 제거. (P0, EN과 연동)
- **표 헤더 "Feature" (page.tsx:88)** 및 **셀 각주(subscription/proprietary/IDE only/Apache 2/Python)**: KO 로케일에서 영문 그대로 노출 — EN↔KO 정합성 깨짐. i18n 키화 필요. (P2)
- **용어 일관성**: "프로바이더(provider)"는 ko 전반에서 일관. "임베드/임베딩"이 카드 제목("임베드 가능한 SDK")과 whenElse("임베딩이나 SDK")에서 혼용 — "임베드"로 통일 권장. (P2)
- **differentiators[3].body (122행)**: KO "절대 외부로 나가지 않습니다"는 EN "never leave"의 직역으로 동일한 과장. EN P1 수정(조건 명시)과 함께 KO도 "로컬 모델로 연결하면 … 머신을 벗어나지 않습니다"로 동기화. (P1)
- **tryButton**: EN/KO 의미 일치, 문제 없음.
