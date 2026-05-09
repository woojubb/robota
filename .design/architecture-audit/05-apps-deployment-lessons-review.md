# 앱 배포 & 아키텍처 교훈 검수 보고서

## 검수 요약

- 검수 날짜: 2026-05-09
- 검수 문서: `apps-and-deployment.md`, `architecture-lessons.md`
- 총 발견 항목: 7건 (심각 0, 경고 4, 정보 3)

---

## 규칙 준수 현황

| #   | 항목                         | 상태    | 비고                                                |
| --- | ---------------------------- | ------- | --------------------------------------------------- |
| 1   | 실제 앱 구조 일치            | ⚠️ 경고 | `blog` 앱이 문서에 누락됨                           |
| 2   | CF Dynamic Workers 참조 금지 | ✅ 준수 | 관련 참조 없음                                      |
| 3   | 배포 토폴로지 일관성         | ⚠️ 경고 | `agent-web`, `agent-server` 배포 플랫폼 미기재      |
| 4   | 아키텍처 교훈 완결성         | ✅ 준수 | 3건 모두 resolved 상태                              |
| 5   | Docs 배포 기술 정확성        | ✅ 준수 | Cloudflare Pages + Wrangler 직접 업로드 정확히 기재 |
| 6   | Three doc layers 동기화 안내 | ⚠️ 경고 | 앱 변경 시 3계층 동기화 의무 미언급                 |
| 7   | v2.0.0 문서 보존 규칙        | ⚠️ 경고 | 배포 문서에 v2.0.0 삭제 금지 규칙 미언급            |
| 8   | 브랜치 정책 반영             | ✅ 준수 | `main`에서 자동 배포 원칙 기재됨                    |
| 9   | 실제 앱 패키지 존재 확인     | ✅ 준수 | `agent-web`, `agent-server`, `docs` 모두 존재       |

---

## 발견된 문제

### [경고-1] blog 앱 누락

**위치:** `apps-and-deployment.md` — Agent App Deployment Stack 및 Deployment 소유권 테이블

**설명:**
실제 `apps/` 디렉토리에는 `agent-web`, `agent-server`, `docs`, `blog` 4개 앱이 존재한다.
그러나 `apps-and-deployment.md`의 배포 소유권 테이블에는 `agent-web`, `agent-server`, `apps/docs` 3개만 기재되어 있다.
`apps/blog`는 Astro + Starlight 기반 정적 사이트로, `apps/blog/docs/SPEC.md`에 "Cloudflare Pages or compatible static hosting"으로 배포함이 명시되어 있다.
`git-branch.md`의 배포 규칙에도 "Cloudflare Pages (blog, docs) deploys automatically when `main` is updated"라고 명기되어 있다.

**권장 수정 방향:**
배포 소유권 테이블에 `apps/blog` 행 추가.

```
| `apps/blog` | Static blog site (Astro Starlight) | Deploys to Cloudflare Pages automatically from `main`. |
```

또한 Documentation Deployment Stack 다이어그램도 `apps/docs` 한정으로 기술되어 있으므로, `blog`의 별도 빌드/배포 경로(Astro → Cloudflare Pages)가 간략히 언급되어야 한다.

---

### [경고-2] agent-web, agent-server 실제 배포 플랫폼 미기재

**위치:** `apps-and-deployment.md` — Deployment ownership 테이블의 `agent-web`, `agent-server` 행

**설명:**
문서는 `agent-web`을 "Next.js frontend host"로, `agent-server`를 "Node service with WebSocket support"로 기술하나, 실제 배포 플랫폼은 명시되지 않는다.

실제 확인된 배포 설정:

- `apps/agent-web/vercel.json` 존재 → Vercel 배포
- `apps/agent-server/package.json`의 `keywords`에 `firebase`, `functions` 포함, `deploy:functions` 스크립트 → Firebase Functions 배포
- `apps/agent-server/docs/SPEC.md`: "Deployable standalone or as Firebase Functions"

이 정보가 누락되면 신규 기여자가 배포 경로를 파악하기 어렵다.

**권장 수정 방향:**
배포 소유권 테이블의 `Runtime shape` 컬럼 또는 `Required contract` 컬럼에 플랫폼을 간략히 추가.

```
| `agent-web`    | Next.js (Vercel) | ...
| `agent-server` | Node / Firebase Functions | ...
```

---

### [경고-3] Three doc layers 동기화 의무 미언급

**위치:** `apps-and-deployment.md` 전체

**설명:**
메모리 피드백 규칙(`feedback_three_doc_layers_sync.md`)과 `operational.md`의 Feature Documentation Requirement에 따라, 코드 변경 후에는 `SPEC.md + README.md + content/` 3계층을 동시에 업데이트해야 한다.
`apps-and-deployment.md`는 앱/서비스 배포의 아키텍처 문서이지만, 앱 변경 시 이 3계층 동기화 의무를 안내하는 내용이 없다.
`architecture-lessons.md`의 Governance 섹션에는 구조 변경 체크리스트가 있지만 docs 콘텐츠 동기화(`content/`) 항목이 빠져 있다.

**권장 수정 방향:**
`apps-and-deployment.md` 하단 또는 `architecture-lessons.md`의 Governance 체크리스트에 다음을 추가:

> When an app or deployment boundary changes, update all three: `docs/SPEC.md`, `README.md`, and `content/` (robota.io docs).

---

### [경고-4] v2.0.0 문서 보존 규칙 미언급

**위치:** `apps-and-deployment.md` — Documentation Deployment Stack 섹션

**설명:**
메모리 피드백 규칙(`feedback_v2_docs_preserve.md`)에 따라 `content/v2.0.0/`은 절대 삭제 금지 대상이다.
실제로 `content/v2.0.0/` 디렉토리가 존재하며, docs 빌드 파이프라인(`copy-docs.js` → `vitepress build`)이 이 콘텐츠를 처리한다.
그러나 배포 문서 어디에도 이 영구 보존 규칙이 언급되지 않는다.
docs 배포 체인에 관여하는 기여자가 정리 과정에서 실수로 삭제할 위험이 있다.

**권장 수정 방향:**
Documentation Deployment Stack 섹션에 주의 항목 추가:

> `content/v2.0.0/` must never be deleted. It is a permanently preserved versioned archive.

---

### [정보-1] docs 배포 스크립트 경로 — 문서 기재와 실제 일치

**위치:** `apps-and-deployment.md` — Manual direct upload 행

**설명:**
문서에 `scripts/docs/deploy-cloudflare-pages.mjs`로 기재되어 있으며, 실제로 해당 경로에 파일이 존재한다. `pnpm docs:deploy` 스크립트도 이 파일을 호출한다. 문제 없음.

---

### [정보-2] architecture-lessons.md — INFRA-BL-006 완료 확인

**위치:** `architecture-lessons.md` — SYS-AUDIT-005

**설명:**
`SYS-AUDIT-005`가 `INFRA-BL-006`으로 해소되었다고 기재되어 있다.
실제로 `.agents/tasks/completed/INFRA-BL-006-docs-cloudflare-migration.md`가 존재하고 status: completed 상태다. 일치함.

---

### [정보-3] SYS-AUDIT-006 follow-up backlog — 현재 backlog 항목 없음

**위치:** `architecture-lessons.md` — SYS-AUDIT-006

**설명:**
"resolved by capability-placement.md with follow-up backlog"으로 기재되어 있으나, `.agents/backlog/` 디렉토리에는 `completed/` 서브디렉토리와 `README.md`만 존재하며 SYS-AUDIT-006 관련 팔로업 backlog 항목이 확인되지 않는다.
`capability-placement.md` 내에 "backlog item for mechanical guard coverage" 언급이 있지만 실제 backlog 파일이 없다.
현재 active backlog 항목이 비어 있거나 completed 처리되었을 가능성도 있으나, 명시적으로 기록되지 않아 추적이 불가능하다.

**권장 수정 방향:**

- 이미 완료된 경우: `architecture-lessons.md`에 "follow-up backlog completed"로 업데이트
- 미완료인 경우: `.agents/backlog/INFRA-BL-XXX-mechanical-guard-coverage.md` 파일 생성

---

## 권장 수정 사항 (우선순위 순)

| 우선순위 | 항목                                | 위치                                                    | 작업                                            |
| -------- | ----------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| P1       | blog 앱 배포 소유권 추가            | `apps-and-deployment.md`                                | 테이블에 `apps/blog` 행 추가, 다이어그램 보완   |
| P2       | agent-web/agent-server 플랫폼 명시  | `apps-and-deployment.md`                                | Vercel, Firebase Functions 배포 플랫폼 기재     |
| P3       | v2.0.0 보존 규칙 추가               | `apps-and-deployment.md`                                | Documentation Deployment Stack에 주의 항목 추가 |
| P4       | Three doc layers 동기화 안내 추가   | `apps-and-deployment.md` 또는 `architecture-lessons.md` | 앱 변경 시 3계층 동기화 의무 명시               |
| P5       | SYS-AUDIT-006 follow-up 상태 명확화 | `architecture-lessons.md`                               | backlog 완료 여부 기록 또는 파일 생성           |
