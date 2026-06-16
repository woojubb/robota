# 전역/일관성 검토 (Header·Footer·common·사이트 전반)

검토 범위: `apps/www/src/components/Header.tsx`, `apps/www/src/components/Footer.tsx`, `en.json`/`ko.json`의 `common` 키, 그리고 사이트 전반의 일관성 판단을 위한 전체 페이지 카피 훑어보기.
검토일: 2026-06-16 · 검토자 관점: 출시 전 최종 카피 리뷰 (PM)

---

## 요약

- **라이선스(AGPL-3.0)가 사이트 전역에 과다 노출**되어 있다. 헤더에는 없지만 footer.tagline, footer.copyright, home 히어로, home features 카드, compare, enterprise 등 거의 모든 표면에 반복 등장한다. AGPL-3.0은 실무적 의무(특히 네트워크 사용 시 소스 공개)를 동반하는 **라이선스 선택지일 뿐 사용자 혜택이 아니다.** 현재 카피는 이를 "혜택"처럼 프레이밍하고 있어 출시 후 잘못된 기대를 유발할 위험이 있다. → **P0**
- **내비게이션 라벨/경로 불일치.** 헤더 nav 라벨은 "Why Robota"인데 실제 경로는 `/compare`다. 사용자 멘탈 모델("왜?"를 누르면 비교표가 나옴)과 IA가 어긋난다. → **P1**
- **톤이 전반적으로 "유치(childish)"하다.** 이모지 헤딩, "no runtime surprises", "Nothing you don't", "$20/month plans" 같은 과장/구어체가 B2B/개발자 도구 톤과 충돌한다. → **P1**
- **용어 불일치.** "AI agent SDK" vs "AI coding CLI" vs "AI coding assistant", "agent runtime" vs "agent framework" vs "engine/엔진", "프로바이더" vs "provider" 등 핵심 용어가 페이지마다 다르게 쓰인다. → **P1**
- **EN↔KO 정합성**: 대체로 양호하나 home 히어로 title의 KO 번역이 EN과 의미가 어긋나고(번역 중복), copyright/tagline의 "& commercial" 대소문자 불일치 등 소소한 결함이 있다. → **P1/P2**
- 브랜드 케이싱: 로고/워드마크는 chrome에서 소문자 `robota`로 통일되어 있으나, 카피 본문은 항상 대문자 `Robota`다. 이 자체는 일관되나 정책을 명시해 두는 것이 좋다.

---

## 라이선스(AGPL) 메시징 전역 일관성 (PRIMARY)

### 현재 노출 지점 (전역 인벤토리)

| 위치                                | 문구                                                                  | 성격                           |
| ----------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `common.footer.tagline`             | "Dual-licensed: AGPL-3.0 & commercial."                               | chrome (전 페이지)             |
| `common.footer.copyright`           | "© 2026 Robota. AGPL-3.0 & Commercial."                               | chrome (전 페이지)             |
| `home.hero.descriptionSuffix`       | "AGPL-3.0 & commercial."                                              | 히어로                         |
| `home.features[4]`                  | 카드 제목 "AGPL-3.0 & Commercial" + 본문                              | 기능 카드(혜택으로 프레이밍)   |
| `compare.description`               | "open source under the AGPL-3.0, with a commercial license available" | 비교 페이지                    |
| `compare.features[4]`               | "Open source (AGPL-3.0)"                                              | 비교표 행                      |
| `compare.differentiators[2]`        | "Fully Open Source (AGPL-3.0)"                                        | 차별점(혜택으로 프레이밍)      |
| `enterprise.security.highlights[0]` | "AGPL-3.0 & Commercial"                                               | 엔터프라이즈                   |
| `enterprise.faq[3]`                 | 듀얼 라이선스 상세 설명                                               | 엔터프라이즈 FAQ (맥락상 적절) |

→ 동일한 라이선스 사실이 **최소 9개 표면, 그중 chrome 2곳**에 중복 노출. 명백한 과다 노출.

### 문제 진단

1. **Chrome 중복.** footer.tagline과 footer.copyright **둘 다** 라이선스를 명시한다. 모든 페이지 하단에 같은 정보가 2번 반복된다. copyright 줄에 라이선스 명칭을 박는 것은 비정상적 패턴이며, 저작권 표기와 라이선스 고지는 별개 개념이다.
2. **혜택으로 프레이밍.** `home.features[4]`, `compare.differentiators[2]`는 AGPL-3.0을 자물쇠 해제 아이콘(🔓)과 함께 "혜택"으로 제시한다. 그러나 AGPL-3.0은 **네트워크를 통해 수정본을 제공하면 전체 소스를 공개해야 하는 강한 카피레프트 의무**를 동반한다. SaaS에 임베드하려는 상업 사용자에게는 혜택이 아니라 제약이며, 그래서 commercial 라이선스가 존재한다. 현재 카피는 "자유롭게 포크/수정/상업적 사용 — CLA 불필요"라고만 말해 의무를 숨긴다. 출시 후 "AGPL인 줄 모르고 임베드했다"는 컴플라이언스 클레임의 소지가 있다. → **P0**
3. **"& commercial" 대소문자 불일치.** tagline은 소문자 `commercial`, copyright는 대문자 `Commercial`, features 카드 제목은 대문자 `Commercial`. 같은 chrome 안에서도 케이싱이 흔들린다.

### 권장: 단일·중립·차분한 라이선스 표기 (사이트 전역)

- **원칙**: 라이선스는 **중립적 사실(neutral fact)** 로만 진술하고, "혜택"으로 포장하지 않는다. 진짜 혜택(소스 공개로 인한 _감사 가능성_, _자체 호스팅 가능성_)은 라이선스 명칭과 분리해 별도 메시지로 말한다.
- **표준 문구 (EN)**: `Open source (AGPL-3.0). A commercial license is available.`
- **표준 문구 (KO)**: `오픈소스 (AGPL-3.0). 상업용 라이선스 별도 제공.`
- **노출해야 할 곳**: footer.tagline 1회, enterprise FAQ(상세), compare 비교표 행 1회. → 총 3곳으로 축소.
- **노출하지 말아야 할 곳 (제거 권장)**:
  - `footer.copyright`에서 라이선스 명칭 제거 → `© 2026 Robota` 만 남긴다. (저작권 ≠ 라이선스)
  - `home.hero.descriptionSuffix`에서 라이선스 제거 → 히어로는 가치 제안에 집중. 라이선스는 스크롤 아래/footer가 담당.
  - `home.features[4]` 카드는 "AGPL-3.0 & Commercial"이라는 라이선스 명칭 대신 **혜택**("Auditable & self-hostable" / "감사 가능 · 자체 호스팅")으로 제목을 바꾸고, 본문에서만 "AGPL-3.0, 상업용 라이선스 별도" 사실을 1줄로 첨부.
- 케이싱은 `commercial` 전부 소문자(문장 내) 또는 `Commercial`(제목 케이스)로 통일. 권장: 본문/태그라인은 소문자, 제목 케이스 헤딩에서만 대문자.

---

## 내비게이션/IA 이슈

1. **"Why Robota" → `/compare` 라벨/경로 불일치 (P1).** 헤더 nav와 footer 둘 다 "Why Robota" 라벨이 `/compare`로 연결된다. compare 페이지 자체의 H1은 "Why Robota?"라 페이지 콘텐츠와는 맞지만, **URL이 `/compare`** 라 라우트 의미와 라벨이 어긋난다. 두 가지 정합안 중 택1:
   - (A) 라벨을 "Compare" / "비교"로 바꾸고 nav 의미를 비교표로 명확화, 또는
   - (B) 라우트를 `/why`로 변경하고 "Why Robota"를 유지. (라우트 변경은 다른 리뷰어 범위와 겹치므로 옵션 제시만 함.)
2. **헤더 nav에 Docs/GitHub가 nav 그룹 밖 우측에 분리 배치 (P2 — 정보성).** 기능적으로는 정상이나, footer는 GitHub/Docs를 Developers 그룹에 넣는다. 헤더와 footer의 분류 모델이 다른 점만 인지하면 됨. 변경 불필요.
3. **Footer 링크 타깃 점검 결과 — dead link 없음.** docs.robota.io, getting-started, github, npm(@robota-sdk/agent-framework), discussions, issues, enterprise 모두 실제 타깃이 존재한다고 가정 가능한 형태. 단, **npm 링크가 `@robota-sdk/agent-framework`** 인데 히어로 설치 스니펫은 `@robota-sdk/agent-cli`다. CLI를 홍보하면서 footer npm 링크는 framework 패키지로 가는 불일치가 있다(어떤 패키지를 "대표"로 노출할지 정책 필요). → **P2**
4. **Playground 링크 — 의도된 비활성.** `Footer.tsx` 116~124행에서 play.robota.io 링크가 주석 처리됨(WWW-PLAYGROUND-RESTORE 백로그 참조). 부재 자체는 버그 아님(지시대로 플래그하지 않음). 다만 **`common.footer.links.playground` 키가 EN/KO 양쪽에 그대로 남아 미사용 상태**다. → **P2 정리 노트**: 플레이그라운드 출시 전까지 미사용 키이므로, 복원 시점까지 남겨두되 주석/백로그와 연결된 상태임을 메모. 즉시 삭제 불필요(복원 예정이므로).

---

## 톤 & 용어 일관성 + 권장 스타일 가이드

### 톤 문제 (owner 지적 "유치함" 구체화)

- **이모지 헤딩**: home.features의 🔑🔄📦🏠🔓⚡. 개발자 도구로서 한두 개는 허용 가능하나 전 카드 이모지는 캐주얼/유치 인상을 강화. B2B/엔터프라이즈 페이지와 톤 충돌.
- **과장·구어체 카피**:
  - "Everything you need. Nothing you don't." / "필요한 모든 것. 불필요한 것은 없음." — 클리셰.
  - "no runtime surprises" / "런타임 놀라움 없음" — KO "놀라움 없음"은 특히 번역투+유치. → "예기치 않은 런타임 동작 없음" 수준으로.
  - "No $20/month plans" / "월 $20 요금제" — 경쟁사를 겨냥한 가격 저격은 출시 카피에서 가벼워 보임. "월 구독 요금제 없음"으로 중립화.
  - "Start in 30 seconds" / "30초 만에 시작하기" — 과장. "Get started in minutes" 권장.
- **권장 보이스**: _차분하고 정밀한 엔지니어 톤(sober, precise, engineer-to-engineer)._ 단정형 사실 진술, 과장 형용사 제거, 가격 저격 금지.

### 용어 불일치 (사이트 전역)

| 개념          | 현재 혼용                                                | 권장 표준어 (EN / KO)                                                                              |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 제품 1줄 정의 | "AI agent SDK" / "AI coding CLI" / "AI coding assistant" | **"AI agent SDK and CLI" / "AI 에이전트 SDK 및 CLI"** (1차) — "coding assistant"는 비교 맥락에서만 |
| 런타임 핵심   | "agent runtime" / "agent framework" / "engine"·"엔진"    | **"agent runtime" / "에이전트 런타임"** 으로 통일. 패키지명 `@robota-sdk/agent-framework`는 그대로 |
| BYOK          | "BYOK" (약어만, 풀이 없음)                               | 첫 등장 시 **"bring your own key (BYOK)"** 풀이 후 약어 사용                                       |
| provider      | "provider" / "프로바이더"                                | KO는 "프로바이더" 통일 (현재 대체로 일관, 유지)                                                    |
| 임베드        | "Embeddable SDK" / "embed" / "임베드 가능한"             | **"embeddable SDK" / "임베드 가능한 SDK"** 통일 (현재 대체로 일관)                                 |
| 라이선스      | (위 PRIMARY 섹션 참조)                                   | "Open source (AGPL-3.0). Commercial license available."                                            |

### 권장 스타일 가이드 (요약)

1. 워드마크는 chrome에서 소문자 `robota`, 본문에서는 항상 대문자 `Robota`. (현 상태 유지, 정책 명문화)
2. 제품 한 줄 정의는 "AI agent SDK and CLI"로 고정. 페이지마다 바꾸지 않는다.
3. 약어는 첫 등장 시 풀이(BYOK 등).
4. 라이선스는 사실로만 1~3회. 혜택 프레이밍 금지.
5. 이모지 헤딩 축소(0개 권장, 또는 일관된 라인 아이콘으로 대체).
6. 과장 형용사·경쟁사 가격 저격 제거. 단정형 사실 진술.
7. 화살표(↗, →) 사용은 외부 링크 ↗, 인라인 CTA → 로 규칙화(현재 대체로 일관).

---

## 발견 사항

| 심각도 | 위치 (file:key)                                        | 현재 문구                                                                                          | 문제                                                                                                                          | 제안 수정안 (EN / KO)                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | `home.features[4]` (en/ko)                             | "AGPL-3.0 & Commercial" + "free to fork, modify, and use in commercial products — no CLA required" | AGPL-3.0의 카피레프트 의무(네트워크 사용 시 소스 공개)를 숨기고 라이선스를 무조건적 혜택으로 프레이밍. 컴플라이언스 오해 유발 | EN: title "Auditable & self-hostable" / body "Source is public and auditable. Licensed under AGPL-3.0; a commercial license is available for closed-source use." · KO: 제목 "감사 가능 · 자체 호스팅" / 본문 "소스가 공개되어 감사 가능합니다. AGPL-3.0 라이선스이며, 비공개 소스 용도를 위한 상업용 라이선스가 별도로 제공됩니다." |
| P0     | `common.footer.copyright` (en/ko)                      | "© 2026 Robota. AGPL-3.0 & Commercial."                                                            | 저작권 표기에 라이선스 명칭 혼입. chrome 내 라이선스 중복(태그라인과 2중). 저작권≠라이선스                                    | EN: "© 2026 Robota" · KO: "© 2026 Robota"                                                                                                                                                                                                                                                                                           |
| P1     | `common.nav.whyRobota` + Header.tsx(href `/compare`)   | "Why Robota" → `/compare`                                                                          | nav 라벨과 라우트 의미 불일치                                                                                                 | 옵션 A: 라벨 "Compare"/"비교"; 옵션 B: 라우트를 `/why`로 (라우트 변경은 페이지 리뷰어와 조율)                                                                                                                                                                                                                                       |
| P1     | `home.hero.descriptionSuffix` (en/ko)                  | "AGPL-3.0 & commercial." / "AGPL-3.0 및 상업용 라이선스."                                          | 히어로에 라이선스 노출 — 가치 제안 희석, chrome과 중복                                                                        | 히어로에서 라이선스 문구 제거. 가치 제안 문장으로 마무리                                                                                                                                                                                                                                                                            |
| P1     | `home.featuresTitle` (en/ko)                           | "Everything you need. Nothing you don't." / "필요한 모든 것. 불필요한 것은 없음."                  | 클리셰·유치한 톤                                                                                                              | EN: "Built for real TypeScript codebases." · KO: "실제 TypeScript 코드베이스를 위해."                                                                                                                                                                                                                                               |
| P1     | `home.features[0].description` (en/ko)                 | "No $20/month plans, no seat limits" / "월 $20 요금제나 시트 제한"                                 | 경쟁사 가격 저격, 가벼운 톤                                                                                                   | EN: "No subscription, no seat limits." · KO: "월 구독 요금제 없음, 시트 제한 없음."                                                                                                                                                                                                                                                 |
| P1     | `home.features[5].description` (en/ko)                 | "no runtime surprises" / "런타임 놀라움 없음"                                                      | 번역투·유치                                                                                                                   | EN: "no implicit casts, no unexpected runtime behavior." · KO: "암묵적 형변환 없음, 예기치 않은 런타임 동작 없음."                                                                                                                                                                                                                  |
| P1     | `home.cta.title` (en/ko)                               | "Start in 30 seconds" / "30초 만에 시작하기"                                                       | 과장                                                                                                                          | EN: "Get started in minutes" · KO: "몇 분 만에 시작하기"                                                                                                                                                                                                                                                                            |
| P1     | 전역 제품 정의 (home/compare/enterprise)               | "AI agent SDK" vs "AI coding CLI" vs "AI coding assistant" 혼용                                    | 핵심 제품 정의 불일치                                                                                                         | 1차 정의를 "AI agent SDK and CLI" / "AI 에이전트 SDK 및 CLI"로 통일                                                                                                                                                                                                                                                                 |
| P1     | 전역 런타임 용어                                       | "agent runtime" / "engine"·"엔진" / "agent framework" 혼용                                         | 핵심 개념 용어 흔들림                                                                                                         | "agent runtime" / "에이전트 런타임"으로 통일 (compare differentiators의 "engine/엔진" 포함)                                                                                                                                                                                                                                         |
| P2     | `common.footer.tagline` (en) vs `copyright`/`features` | "commercial"(소문자) vs "Commercial"(대문자)                                                       | 동일 chrome 내 케이싱 불일치                                                                                                  | 본문/태그라인은 소문자 "commercial"로 통일                                                                                                                                                                                                                                                                                          |
| P2     | `common.footer.links.npm` + Footer.tsx href            | npm → `@robota-sdk/agent-framework`, 히어로 설치는 `@robota-sdk/agent-cli`                         | 대표 패키지 불일치(CLI 홍보 vs framework 링크)                                                                                | 대표 패키지 정책 확정 후 한쪽으로 통일(권장: CLI 페이지 맥락이면 agent-cli)                                                                                                                                                                                                                                                         |
| P2     | `common.footer.links.playground` (en/ko)               | "Playground" / "플레이그라운드"                                                                    | 링크 주석처리로 현재 미사용 키                                                                                                | 플레이그라운드 복원 전까지 미사용. WWW-PLAYGROUND-RESTORE와 연결된 상태로 유지(복원 예정이므로 삭제 보류)                                                                                                                                                                                                                           |
| P2     | `home.features` 이모지 헤딩 (en/ko)                    | 🔑🔄📦🏠🔓⚡                                                                                       | 캐주얼/유치 인상, 엔터프라이즈 톤 충돌                                                                                        | 이모지 제거 또는 일관된 라인 아이콘 세트로 교체                                                                                                                                                                                                                                                                                     |

---

## EN↔KO 정합성 이슈

1. **`home.hero.title` 의미 어긋남 (P1).** EN: "The open-source AI agent SDK" + highlight "that you actually own". KO: "진정한 소유권을 갖는 오픈소스 AI 에이전트 SDK" + highlight "당신이 직접 소유하는". KO에서 title과 titleHighlight가 **"소유"의 의미를 중복**으로 담아 두 조각이 겹치고 어색하다(title 본문에 이미 "소유권을 갖는"이 들어가 highlight가 잉여). → KO title을 "오픈소스 AI 에이전트 SDK", highlight를 "당신이 직접 소유하는"으로 분리하여 EN 구조와 일치시킬 것.
2. **`footer.tagline`/`copyright` 케이싱·표기 (P2).** EN "commercial"(소문자) vs KO "상업용" — KO는 케이싱 이슈 없음이나, EN 내부 불일치는 위 표 참조. KO copyright "AGPL-3.0 및 상업용."도 P0 권고대로 라이선스 제거 시 함께 정리.
3. **번역투 잔존 (P1).** "런타임 놀라움 없음"(위), "불필요한 것은 없음" 등 직역투. 자연스러운 한국어 기술 카피로 다듬을 것.
4. **language switcher (P2 — 양호).** `common.lang.en/ko` = "EN"/"KO". Header.tsx에서 `otherLocale`만 토글 표시(현재 언어 대비 전환 대상 표시) — 동작/aria-label 정상. 변경 불필요.
5. **beta 배지 (P2 — 양호).** Header 워드마크 옆 "beta" 배지는 EN/KO 공통 하드코딩(`beta`)으로 i18n 키 없이 영문 고정. 글로벌 통용어이므로 허용. 단 home.hero.badge는 "Public Beta · v3.0.0-beta" / "공개 베타 · v3.0.0-beta"로 현지화되어 있어 두 표기(영문 "beta" vs "공개 베타")가 공존 — 의도된 차이로 보이나 인지만.
6. **브랜드 케이싱 일관성 (양호).** chrome 워드마크는 EN/KO 모두 소문자 `robota`(Header 27행, Footer 15행), 본문 카피는 대문자 `Robota`. 양 언어 일관. 정책 명문화 권장.
