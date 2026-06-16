# apps/www 출시 전 PM 카피 검토 — 종합 보고서

검토일: 2026-06-16 · 방식: 페이지/파트를 5개로 나눠 병렬 에이전트 검토 → 종합
검토 대상: `apps/www` 전체 (home / compare / enterprise / roadmap / showcase / beta / Header / Footer / common)

세부 보고서:

- [01-home.md](01-home.md) — 홈
- [02-compare.md](02-compare.md) — 비교
- [03-enterprise.md](03-enterprise.md) — 엔터프라이즈
- [04-roadmap-showcase-beta.md](04-roadmap-showcase-beta.md) — 로드맵·쇼케이스·베타
- [05-global-consistency.md](05-global-consistency.md) — 전역/일관성

---

## 한 줄 결론

문구의 "유치함"보다 **출시 즉시 신뢰를 깎는 사실성 문제(AGPL 오표현·과장 단언·동작하지 않는 베타 폼·낡은 로드맵)** 가 더 큰 리스크다. 아래 P0를 먼저 막고, 그다음 톤/용어를 정리해야 한다.

---

## 교차 테마 (심각도순)

### 1. AGPL을 "장점"으로 포장 — P0 (오너가 직접 지적한 핵심)

AGPL-3.0은 카피레프트 + 네트워크 소스 공개(Section 13) 의무를 가진 **라이선스 선택**이지 사용자 혜택이 아니며, 상업 사용자에게는 오히려 제약이다. 그런데 사이트 **9곳 이상(그중 chrome 2곳)** 에서 AGPL을 차별점/혜택으로 노출한다.

- `home.features[4]` "🔓 AGPL-3.0 & Commercial / ...use in commercial products — no CLA required" — **사실 오도**(의무를 숨기고 자유만 강조)
- `compare.description` 헤드라인 + `compare.features[4]` 비교표 행 + `compare.differentiators[2]` "Fully Open Source (AGPL-3.0)" — 비교표 데이터상 Aider(Apache 2)·Cline도 ✓라 **이기지도 않는 행을 우위로 표시**
- `enterprise.security.highlights[0]` — 라이선스를 보안 기능으로 분류(범주 오류)
- `footer.tagline` + `footer.copyright` — chrome에 2중 노출, 저작권 줄에 라이선스 혼입

→ **방향**: 라이선스는 중립적 사실로 1~3곳만(footer 1회 + enterprise FAQ + compare 비교표 행). 진짜 혜택(감사 가능·자체 호스팅·락인 없음)은 라이선스 명칭과 분리해 진술. 표준 문구: "Open source (AGPL-3.0). A commercial license is available." / "오픈소스 (AGPL-3.0). 상업용 라이선스 별도 제공." (→ **WEB-006**)

### 2. 검증 불가/오해 소지 단언 — P0

- `compare.description` "**The only** AI coding CLI that…" — 절대 단언
- `compare.differentiators[1]` "**No other** AI coding assistant exposes this — Claude Code, Cursor, Cline are closed products" — 같은 페이지 표(Aider=오픈소스)와 모순, 공정성 시비
- `enterprise.security.highlights[3]` "**SOC 2 / ISO 27001 compatible**" — 미보유 인증 암시(조달·법무 최대 리스크)
- `enterprise.contact` "**30 business days** 이내 응답" — ~6주, 자해성
- `home.features[3]`/`compare.differentiators[3]` "**No data leaves / never leave** your machine" — 클라우드 프로바이더 사용 시 거짓(조건 명시 필요)
- `enterprise.vulnerabilityDisclosure` "patch within **14 days**" — 공개 SLA로 읽힘
- `enterprise.onPremises` "**fully** air-gapped" — npm 설치는 미러 필요(FAQ와 모순)

→ (→ **WEB-007**)

### 3. 동작하지 않거나 거짓이 되는 기능/데이터 — P0

- **베타 신청 폼이 100% 실패**: `beta/page.tsx`가 `POST /api/beta` 호출하지만 `apps/www/src/app`에 `api` 디렉토리 자체가 없음 → 전 제출 404 + "Submission failed". 게다가 "48시간 내 회신" 약속. (→ **WEB-008**)
- **베타 페이지 i18n 전무**: 모든 문구 영어 하드코딩 → `/ko/beta`도 영어. (→ **WEB-008**)
- **로드맵 버전 코호트 낡음**: 실제 `3.0.0-beta.76`인데 "Now" 표는 `beta.67`(완료)/`beta.68`(예정). beta.68 "예정"은 8베타 전이라 거짓. "최종 업데이트: 2026-05-23"도 24일 경과. (→ **WEB-009**)
- **과대약속**: "Robota Cloud beta"(미구현), `robota-sdk/action@v1`(미존재 슬러그), "v1.0.0 RC"를 분기까지 못 박음. (→ **WEB-009**)

### 4. 톤("유치함")·용어 불일치 — P1

- 이모지 헤딩 6종(🔑🔄📦🏠🔓⚡), "Everything you need. Nothing you don't.", "no runtime surprises/런타임 놀라움 없음", "Start in 30 seconds", "$20/month" 경쟁사 저격, 베타 "Limited spots available"·🎉
- 제품 정의 흔들림: "AI agent SDK" vs "AI coding CLI" vs "AI coding assistant"
- 런타임 용어 흔들림: "agent runtime" vs "engine/엔진" vs "agent framework"
- KO 번역투 다수("놀라움 없음", "불필요한 것은 없음", "하에.")

→ 차분한 엔지니어 톤 + 용어 표준화 + 스타일 가이드. (→ **WEB-010**)

### 5. i18n 정합성/하드코딩 버그 — P1/P2

- **엔터프라이즈 렌더 버그(P0급)**: KO `contact.responseTimeSuffix`가 TSX에서 렌더 안 됨 → "...에는 30 영업일." 비문. EN/KO 키 구조 불일치.
- 비교표 헤더 "Feature" + 셀 각주(subscription/proprietary/Apache 2/Python) page.tsx 하드코딩 → KO 로케일에 영문 노출
- `home.hero.title`/`titleHighlight` EN/KO 구조 불일치(KO "소유" 의미 중복)
- footer "& commercial" 대소문자 흔들림, npm 링크(framework) vs 히어로(cli) 불일치, 미사용 `footer.links.playground` 키

→ (→ **WEB-011**)

---

## 이미 처리됨 (이번 세션)

- **Agent Playground 숨김**: Footer 링크 주석 처리 + showcase "Visual Agent Builder Playground" 제거(EN/KO). 복원 백로그 **WEB-005** 생성.

## 권고 실행 순서

1. **WEB-006** 라이선스(AGPL) 표현 정리 — 오너 핵심 지적, P0
2. **WEB-007** 과장/오해 단언 제거 — P0
3. **WEB-008** 베타 페이지(폼 동작 + i18n) — P0, 기능 장애
4. **WEB-009** 로드맵 최신성/정확성 — P0
5. **WEB-010** 톤·용어 정리 + 스타일 가이드 — P1
6. **WEB-011** i18n 정합성/하드코딩 버그 — P1/P2

세부 문구 수정안(EN/KO)은 각 세부 보고서의 표에 위치까지 명시되어 있다. 백로그는 그 표를 SSOT로 참조한다.
