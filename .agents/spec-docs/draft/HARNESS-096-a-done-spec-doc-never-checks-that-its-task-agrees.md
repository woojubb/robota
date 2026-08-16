---
status: draft
type: INFRA
tags: [infra]
---

# HARNESS-096: `done/`의 spec-doc은 자기 태스크가 동의하는지 확인하지 않는다 — 게이트 5건이 존재하지 않는 작업을 통과시켰다

## Problem

**세 항목이 `.agents/spec-docs/done/`에 `status: done`으로, 각각 게이트 기록 5건을 달고 앉아 있는데,
그 작업은 저장소에 존재하지 않는다.**

| ID        | spec-doc            | 트리 실측                                                               | 짝 태스크가 적어둔 것                 |
| --------- | ------------------- | ----------------------------------------------------------------------- | ------------------------------------- |
| `CLI-032` | `done/`, 게이트 5건 | git 명령 모듈 없음. `/status`·`/diff`·`/commit` 중 무엇도 존재하지 않음 | _"Reopened: nothing was implemented"_ |
| `CLI-034` | `done/`, 게이트 5건 | `packages/plugin-*` 디렉터리 자체가 없음                                | _"Reopened: nothing was implemented"_ |
| `PM-026`  | `done/`, 게이트 5건 | `apps/action/action.yml`은 존재, 마켓플레이스 미게시                    | _"Reopened as partially shipped"_     |

`CLI-032`의 `/status` 검색 히트는 전부 무관한 transport 테스트 파일이다. 셋 다 독립 재확인했다.

태스크 쪽은 **이미 옳다** — 2026-07-25 `PROC-001` 정합 작업이 셋을 재개하면서 근거까지 적었다
(_"PR #589 archived this with checked task boxes, but its diff touched no git command module"_).
문제는 그 정정이 **태스크 트리에만 반영되고 spec-doc은 `done/`에 그대로 남았다**는 것이다.

### 왜 어떤 스캔도 못 잡나

- `scan-doc-folder-status-agreement.mjs` — `status:` ↔ **폴더**만 본다. `status: done` + `done/`이면
  통과다. 태스크가 뭐라 하는지는 보지 않는다.
- `scan-unearned-done-claims.mjs`(HARNESS-050) — 완료 기록이 **무언가를 인용하는지**를 fail-closed로
  본다. 인용된 것이 **실재하는지**는 보지 않으며, 그것이 이 셋이 통과하는 이유다. 헤더 주석이 스스로
  적었듯 `check-done-evidence.mjs`는 "있었다가 사라진 증거"를, 이 스캔은 "인용이 아예 없는 경우"를
  덮는다 — **"인용은 있는데 그 대상이 만들어진 적 없는 경우"** 는 셋 다 덮지 않는다.
- `check-task-archival.mjs` / `task-lifecycle.mjs` — 태스크 트리 내부 규율만 본다.

즉 **spec-doc과 그 짝 태스크가 서로 다른 말을 해도 기계는 침묵한다.** 이 저장소에서 그 둘은
_"pair by design — problem here, plan there, one ID across both"_(`tasks/README.md`)인데, 그 짝을
검사하는 것이 없다.

### 왜 중요한가

이것은 `HARNESS-052`가 쓸어담는 vacuous green의 **가장 비싼 형태**다 — 초록이 잘못된 것이 아니라
**게이트가 없는 일을 완료로 확정**했다. 그리고 그 확정이 남아 있는 한 `done/` 256건 전체의 신뢰도가
셋만큼 깎인다. 어느 것이 진짜인지 문서만 보고는 구별할 수 없다.

## Prior Art Research

Waived: 저장소 안에 형태가 이미 있다. `scan-doc-folder-status-agreement.mjs`가 규칙 문서의
status↔폴더 표를 **파싱해서** 기준으로 삼고 트리 전체를 검사한다 — 사본을 만들지 않는 그 형태를
spec-doc↔태스크 짝에 적용하면 된다. 외부 사례가 결정을 바꾸지 않는다.

## Solution (초안 방향)

**`done/`의 spec-doc마다 같은 ID의 태스크를 찾아, 그 태스크가 완료 상태(`completed/`에 있거나
`status: done`)인지 확인한다.** 어긋나면 finding.

주의할 점 둘 — 조사 중 실제로 부딪힌 것들이라 설계에 넣는다:

1. **ID가 같아도 다른 작업일 수 있다.** `SELFHOST-008`은 done spec-doc이 6건인데 열린 태스크는
   `P5-concrete-semantic-backend`로, P5 spec-doc은 아예 없다. `SELFHOST-003`·`SELFHOST-011`도 같은
   형태(연기된 후속이 부모 ID를 재사용). **ID 일치만으로 짝을 단정하면 오탐 3건이 즉시 나온다.**
   슬러그까지 비교하거나, 태스크가 어느 spec-doc의 짝인지 명시하게 해야 한다.
2. **기존 부채는 baseline으로 동결한다.** 지금 아는 것은 위 3건이지만 `done/` 256건 전수를 돌리면 더
   나올 수 있다. 전부 즉시 해소를 요구하면 스캔이 착지하지 못한다 — 래칫으로 두고 증가만 막는다.

**`done/`에 남은 3건의 처분은 이 항목이 결정하지 않는다.** 각각 재-스코프 판단(태스크 자신이
_"re-scope against the current plugin architecture"_ 라고 적었다)이 필요하고 그것은 제품 결정이다.
스캔이 착지하면 셋이 finding으로 드러나고, 처분은 그때 소유자가 정한다.

## Completion Criteria (초안)

- [ ] TC-01: `done/` spec-doc과 짝 태스크의 완료 상태 불일치를 찾는 스캔이 있고 `pnpm harness:scan`에 등록됨
- [ ] TC-02: 위 3건(`CLI-032`·`CLI-034`·`PM-026`)을 **실제로 잡는다** — 픽스처가 아니라 실물 트리에서
- [ ] TC-03: `SELFHOST-003`·`SELFHOST-008`·`SELFHOST-011`을 **잡지 않는다**(연기된 후속이 부모 ID를
      재사용하는 경우) — 오탐 red-prove
- [ ] TC-04: 짝 태스크를 찾을 수 없으면 **fail-closed**가 아니라 명시적으로 "짝 없음"으로 분류하고
      그 수를 선언한다(`done/` 다수가 태스크 없이 아카이브돼 있다)
- [ ] TC-05: `::examined::`로 검사한 spec-doc 수를 선언 (HARNESS-057)
- [ ] TC-06: 기존 부채 baseline이 있고, 증가하면 실패한다
- [ ] TC-07: `pnpm harness:scan` exit 0

## Evidence Log

- **2026-08-16 — 제기.** 소유자가 _"완료된 백로그 모두 완료 처리"_ 를 지시해 전수 조사한 결과,
  **완료 처리할 항목은 하나도 없었고** 대신 반대 방향의 결함이 나왔다. 조사 방법과 결과:
  - `done/` spec-doc과 열린 태스크가 공존하는 ID **6건** 추출 → 3건은 위 결함, 3건은 연기된 후속의
    ID 재사용(정상)
  - 체크박스가 전부 `[x]`인데 `status != done`인 태스크 → **0건**
  - `done/` 밖에 `GATE-COMPLETE PASS`가 기록된 spec-doc → **0건**
  - 폴더 분포: draft 9 / active 2 / done 256 / rejected 1, 열린 태스크 121 / 완료 809
