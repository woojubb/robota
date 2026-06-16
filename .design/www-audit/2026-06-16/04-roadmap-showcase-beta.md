# 로드맵·쇼케이스·베타 페이지 검토 (apps/www)

검토일: 2026-06-16 · 검토자: PM (출시 전 최종 카피 리뷰)
검토 범위: `roadmap`, `showcase`, `beta` 3개 페이지 (EN/KO 병행)

---

## 요약

- **출시 전 반드시 막아야 할 P0가 4건.** 그중 가장 치명적인 것은 **베타 신청 폼이 동작하지 않는다는 점**이다. `beta/page.tsx`는 `POST /api/beta`로 제출하지만 `apps/www/src/app`에 `api` 디렉토리 자체가 존재하지 않는다(`[locale]`, `globals.css`, `layout.tsx`, `page.tsx`만 존재). 제출 시 404가 떨어지고 "Submission failed" 에러가 노출된다. 동시에 폼 하단/제출 후 화면은 "48시간 내 검토·온보딩 가이드 회신"을 약속한다 — 받을 수 없는 신청을 받겠다고 약속하는 상태.
- **로드맵 버전/날짜가 출시 시점에 거짓이 된다.** 실제 현재 버전은 `3.0.0-beta.76`인데, 로드맵 "Now" 표는 `beta.67`(완료)·`beta.68`(예정) 항목으로 채워져 있다. beta.68은 이미 8개 베타 이전이라 "예정(Planned)"이 명백히 거짓이다. "최종 업데이트: 2026-05-23"도 출시일 기준 한 달 가까이 지난 날짜다.
- **과대약속 다수.** "Robota Cloud 베타", "v1.0.0 릴리스 후보", "GitHub Actions 공식 액션(`robota-sdk/action@v1`)" 등 아직 존재하지 않는 제품/버전을 분기(Q3 2026)까지 못 박아 약속하고 있다. 출시 직후 검증 불가능하고 미달 시 신뢰를 깎는다.
- **톤은 베타 페이지가 가장 문제.** "Be among the first developers to shape Robota", 🎉 이모지, "Limited spots available" 등 오너가 지적한 "유치함/과대포장"의 전형. 로드맵/쇼케이스 본문 톤은 대체로 차분해 양호하다.
- **AGPL 프레이밍은 이 3개 페이지에 직접 노출 없음** — 별도 위반 없음(타 페이지 검토 권장).
- **EN↔KO는 대체로 양호**하나 번역투/날짜포맷/용어 미세 불일치 몇 건.

---

## 로드맵: 최신성/정확성 이슈 (날짜·버전·과대약속)

1. **버전 코호트 불일치 (P0).** 실제 빌드 버전 `3.0.0-beta.76` (확인: `packages/agent-framework/package.json`, `packages/agent-cli/package.json`). 로드맵 "Now" 표 10개 항목 중 8개가 `beta.67`(완료), 2개가 `beta.68`(예정). beta.68 항목("세션 자동 명명", "/cost 세션별 비용 추적")을 "Planned/예정"으로 표기하는 것은 9개 베타 이전 마일스톤이므로 출시 시점 기준 거짓. 실제 완료 여부를 코드로 재확인 후 상태를 갱신하거나, 표를 버전 단위가 아닌 테마 단위로 추상화해야 한다.

2. **`descriptionHighlight`의 버전 표기 (P1).** `public beta (v3.0.0-beta)` — 패치 번호 없는 표기 자체는 무방하나, 위 표가 `beta.67`로 고정돼 있어 페이지 내부에서 "현재 beta(76)"와 "표(67)"가 서로 다른 시점을 가리키는 불일치를 만든다. 표를 갱신하면 해소.

3. **"최종 업데이트: 2026-05-23" (P0).** 오늘(2026-06-16) 기준 24일 전. 출시 직후 방문자에게 "방치된 로드맵"으로 보인다. 정적 날짜를 박지 말고 (a) 최신 날짜로 갱신하거나 (b) "분기별 업데이트" 문구만 남기고 절대 날짜 제거 권장.

4. **"분기별로 업데이트됩니다 / This page is updated quarterly" (P1).** 분기 갱신을 명시하면 다음 갱신 기한(2026-07~09)이 자동으로 약속이 된다. 갱신 운영을 보장할 수 없다면 "정기적으로(regularly)"로 완화.

5. **"Q2 2026 · 활성 개발 기간" (P1).** Q2(4~6월)는 출시 시점에 보름밖에 안 남았다. 출시 후 곧 Q3가 되어 "Now" 헤더가 과거를 가리킨다. 분기 라벨 대신 "현재 개발 중" 같은 상대 표현 권장.

6. **"Robota Cloud 베타" (P0).** `next.items[4]`. 호스팅 세션·팀 공유·사용량 대시보드·BYOK 무료 티어를 Q3에 약속. 메모리상 클라우드 제품은 미구현·미배포 상태. 구체 기능과 분기를 못 박으면 미달 시 거짓 광고가 된다. 분기 제거 + "탐색 중(Later)"으로 강등하거나 문구에서 제거.

7. **"v1.0.0 릴리스 후보" (P1).** Q3로 분기를 못 박은 점이 위험. "P0 버그 전부 해결 + 핵심 여정 검증 시" 조건부 표현은 좋으나, 헤더가 "Next — Q3 2026"이라 조건과 분기가 충돌. 분기 약속을 빼고 조건만 남길 것.

8. **"GitHub Actions 공식 액션 `robota-sdk/action@v1`" (P1).** 존재하지 않는 액션의 정확한 슬러그/버전을 노출. 출시 시 누가 URL을 찍어보면 404. 정식 슬러그는 출시 시점에 확정하고, 그 전에는 슬러그 미노출 권장.

9. **GitHub Discussions 링크 (P2).** `vote.githubDiscussions`가 `github.com/woojubb/robota/discussions`로 연결. 저장소에 Discussions가 비활성화돼 있으면 404. 출시 전 Discussions 활성화 여부 확인 필요.

---

## 쇼케이스: 사실성 이슈

1. **"Featured Projects"에 Robota CLI 단 1개 (P1, 사실성은 OK).** "Visual Agent Builder Playground"가 제거된 것은 올바른 판단(플레이그라운드 미출시). 남은 항목 "Robota CLI"는 실제 존재(`packages/agent-cli`, 버전 beta.76)하고 `@robota-sdk/agent-framework`도 실재하므로 **사실성 위반 없음**. 다만 "Featured Projects(주요 프로젝트/복수)"라는 복수형 제목 아래 1개만 있으면 빈약해 보인다. 제목을 단수 친화적으로("Featured Project") 바꾸거나, 빈 느낌을 줄이는 카피 보강 권장.

2. **`description`의 "from terminal coding assistants to embedded AI in custom applications" (P2).** "터미널 코딩 어시스턴트"는 Robota CLI로 입증되지만 "커스텀 앱 임베드 AI"를 보여주는 실제 사례가 쇼케이스에 0건. 입증 사례 없는 범위를 암시하므로, SDK 임베딩 예제가 실제로 추가되기 전까지는 범위를 CLI 중심으로 좁히는 것이 안전.

3. **"Community Projects" 빈 상태 (P2, 카피는 양호).** `communityEmpty` = "아직 등록된 커뮤니티 프로젝트가 없습니다. 첫 번째로 제출해보세요." — 자연스럽고 정직함. 통과. 다만 EN "Be the first to submit yours."와 KO 어조가 미세하게 다름(아래 정합성 참고).

4. **제출 요건 "PR 날짜 기준으로 작동해야 함" (P2).** EN "Must be working as of the PR date"는 자연스럽지만 KO는 번역투. "PR 시점에 정상 동작해야 함" 정도로 다듬기 권장.

---

## 베타 페이지 이슈

1. **`/api/beta` 엔드포인트 부재 — 폼이 작동하지 않음 (P0, 최우선).** `beta/page.tsx:38`이 `POST /api/beta` 호출. `apps/www/src/app` 하위에 `api` 디렉토리 자체가 없음. 결과: 모든 제출이 404 → catch 블록 → "Submission failed: Not Found" 에러 배너 노출. 출시 시 신청 폼이 100% 실패. 출시 전 (a) API 라우트 구현 또는 (b) 외부 폼(예: 메일/Tally/Typeform)으로 교체 또는 (c) 폼을 비활성화하고 "곧 공개" 처리 중 택1 필수.

2. **베타 페이지 카피가 i18n 미적용 (P1).** 이 페이지는 `en.json`/`ko.json` 키를 전혀 쓰지 않고 모든 문구가 영어 하드코딩(`'use client'` 컴포넌트). 사이트가 한국어 로케일을 지원하는데 `/ko/beta`에서도 영어만 노출 → 로케일 일관성 깨짐. 다른 페이지와 동일하게 `beta` 키를 messages에 추가해 번역 적용 필요.

3. **톤 — 오너 지적("유치함")의 핵심 (P1).**
   - "Limited spots available" — 인위적 희소성 마케팅 클리셰.
   - "Be among the first developers to shape Robota." / "their feedback directly drives the roadmap" — 과대포장.
   - 제출 후 🎉 이모지 + "Application received!" — 가벼움.
     차분하고 사실 기반 카피로 교체 권장(아래 표).

4. **"48시간 내 회신" 운영 약속 (P1).** `beta/page.tsx:62`(제출 후)·`:186`(폼 하단) 두 곳에서 "48시간 내 검토 + 온보딩 가이드 회신" 약속. 실제 운영 SLA가 없으면 미달 시 신뢰 손상. 시간 약속을 빼거나 "검토 후 회신"으로 완화. (게다가 #1로 인해 현재는 접수 자체가 안 됨.)

5. **버튼 텍스트 색상 하드코딩 (P2, 비카피).** `:180` `text-white` 하드코딩 — 다른 페이지는 `var(--primary-foreground)` 사용. 일관성 차원의 참고 사항(카피 범위 외).

---

## 발견 사항

| 심각도 | 위치 (file:key)                     | 현재 문구                                                                                                                                                    | 문제                                                              | 제안 수정안 (EN / KO)                                                                                                                                                                                                                     |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | `beta/page.tsx:38` (`/api/beta`)    | `fetch('/api/beta', { method: 'POST' ... })`                                                                                                                 | 해당 API 라우트·`api` 디렉토리 미존재 → 제출 시 404, 폼 전면 실패 | (코드) 라우트 구현 또는 외부 폼으로 교체. 미구현 시 폼 비활성화 + "Beta applications open soon" / "베타 신청은 곧 열립니다"                                                                                                               |
| **P0** | `en/ko.json roadmap.now.items[8,9]` | `... "status": "planned", "release": "beta.68"`                                                                                                              | 실제 빌드 `beta.76`. beta.68 "예정"은 거짓                        | 실제 상태 재확인 후 done/제거, 또는 버전 라벨 제거하고 테마로 추상화 (EN: drop per-beta tags / KO: 베타별 태그 제거)                                                                                                                      |
| **P0** | `roadmap.lastUpdated`               | `Last updated: 2026-05-23 ·` / `최종 업데이트: 2026-05-23 ·`                                                                                                 | 24일 경과, 출시 시 방치 인상                                      | 출시일로 갱신하거나 절대 날짜 제거 (EN: `Reviewed regularly ·` / KO: `정기적으로 검토됩니다 ·`)                                                                                                                                           |
| **P0** | `roadmap.next.items[4]`             | `Robota Cloud beta — hosted sessions, team sharing, usage dashboard (BYOK free tier)` / KO 동일                                                              | 미구현·미배포 제품을 Q3로 약속                                    | 제거하거나 Later로 강등, 분기·세부기능 삭제 (EN: `Hosted experience (exploratory)` / KO: `호스팅 환경(탐색 중)`)                                                                                                                          |
| **P1** | `beta/page.tsx:80-82`               | `Be among the first developers to shape Robota. Beta members get direct access to the team, early features, and their feedback directly drives the roadmap.` | 과대포장·유치한 톤, 미적용 i18n                                   | EN: `Robota is in active beta. Join early to try new features and send feedback that informs what we build next.` / KO: `Robota는 활발한 베타 단계입니다. 일찍 합류해 새 기능을 사용해보고, 다음 개발 방향에 반영될 피드백을 보내주세요.` |
| **P1** | `beta/page.tsx:74`                  | `Limited spots available`                                                                                                                                    | 인위적 희소성 마케팅 클리셰                                       | EN: `Now in beta` / KO: `베타 진행 중`                                                                                                                                                                                                    |
| **P1** | `beta/page.tsx:59-63`               | `🎉 Application received! We'll ... within 48 hours ...`                                                                                                     | 가벼운 톤 + 보장 못 하는 SLA                                      | EN: `Thanks — your application is in. We'll follow up by email with next steps.` / KO: `신청이 접수되었습니다. 다음 단계는 이메일로 안내드리겠습니다.` (🎉 제거)                                                                          |
| **P1** | `beta/page.tsx:186`                 | `We review applications within 48 hours and reply with an onboarding guide.`                                                                                 | 48h SLA 미보장                                                    | EN: `We review applications and reply by email.` / KO: `신청을 검토한 뒤 이메일로 회신드립니다.`                                                                                                                                          |
| **P1** | `roadmap.next.title`                | `Next — Q3 2026` / `다음 — Q3 2026`                                                                                                                          | 분기 못 박기 → 항목별 분기 약속화                                 | EN: `Next` / KO: `다음` (분기 라벨 제거)                                                                                                                                                                                                  |
| **P1** | `roadmap.now.subtitle`              | `Q2 2026 · Active development window` / `Q2 2026 · 활성 개발 기간`                                                                                           | 출시 후 곧 과거 분기                                              | EN: `Active development` / KO: `현재 개발 중`                                                                                                                                                                                             |
| **P1** | `roadmap.next.items[1]`             | `... (robota-sdk/action@v1) ...`                                                                                                                             | 미존재 액션 슬러그 노출 → 404 가능                                | 슬러그 제거: EN: `Official GitHub Action — run Robota as a CI bot` / KO: `공식 GitHub 액션 — Robota를 CI 봇으로 실행`                                                                                                                     |
| **P1** | `roadmap.next.items[0]`             | `v1.0.0 release candidate — ...` (under `Q3 2026`)                                                                                                           | 조건부 표현인데 헤더가 분기 못 박음                               | 분기 헤더만 제거하면 조건 표현 유지 가능 (문구 자체는 OK)                                                                                                                                                                                 |
| **P1** | `showcase.featuredTitle`            | `Featured Projects` / `주요 프로젝트`                                                                                                                        | 복수형인데 항목 1개 → 빈약                                        | EN: `Featured Project` / KO: `대표 프로젝트` (또는 사례 추가)                                                                                                                                                                             |
| **P2** | `showcase.description`              | `... to embedded AI in custom applications.`                                                                                                                 | 입증 사례 없는 범위 암시                                          | 범위 축소: EN: `... real terminal coding assistants and tools built on the SDK.` / KO: `... SDK로 만든 실제 터미널 코딩 어시스턴트와 도구.`                                                                                               |
| **P2** | `roadmap.vote.githubDiscussions`    | `GitHub Discussions ↗` → `/discussions`                                                                                                                      | Discussions 비활성 시 404                                         | 출시 전 Discussions 활성화 확인, 미활성 시 Issues로 통합                                                                                                                                                                                  |
| **P2** | `roadmap.descriptionSuffix`         | `This page is updated quarterly.` / `이 페이지는 분기별로 업데이트됩니다.`                                                                                   | 분기 갱신 약속                                                    | EN: `Updated regularly.` / KO: `정기적으로 업데이트됩니다.`                                                                                                                                                                               |

---

## EN↔KO 정합성 이슈

1. **베타 페이지 전체 KO 부재 (P1).** `/ko/beta`에서도 영어만 노출(하드코딩). 다른 두 페이지는 next-intl로 번역되는데 베타만 누락 — 가장 큰 정합성 결함. `beta` 키 신설 후 KO 번역 추가 필요.

2. **`showcase.communityEmpty` 어조 차이 (P2).** EN "Be the first to submit yours."(명령형·권유) vs KO "첫 번째로 제출해보세요."(부드러운 권유) — 의미는 일치하나 EN이 약간 더 직설적. 현재 수준은 허용 범위.

3. **`showcase.submitRequirements[2]` 번역투 (P2).** EN "Must be working as of the PR date" → KO "PR 날짜 기준으로 작동해야 함"은 번역투. 자연스러운 표현: "PR 시점에 정상 동작해야 함".

4. **`roadmap.later.subtitle` (P2).** EN "Ideas under consideration. No commitment on timing." vs KO "검토 중인 아이디어. 일정 미확정." — KO가 더 압축적이나 의미 일치, 자연스러움. 통과.

5. **날짜 포맷 (P2).** EN/KO 모두 `2026-05-23` ISO 포맷으로 일치 — 좋음. (단, P0로 갱신 대상)

6. **용어 일관성 (P2).** "release/릴리스", "Plugin/플러그인", "Provider/프로바이더", "Session/세션" 등 표 헤더·태그 용어가 EN↔KO 일관. 별도 이슈 없음. 단 KO `roadmap.now.items` "디렉토리"는 사이트 다른 곳 표기와 통일 권장(디렉터리 vs 디렉토리).
