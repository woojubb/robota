---
status: backlog
type: FLOW
tags: [cli]
---

# PRESET-015: 전환 시 명령 모듈 + 실행능력 라이브 재적용 (연기 에픽)

## Problem

라이브 프리셋 전환 스택(PRESET-011~014)은 active 상태·권한·모델/effort·페르소나까지 라이브 재적용을
완성했다. 남은 두 옵션 그룹 — (B) `enabledCommandModules`/`disabledCommandModules` 재선택, (C) 실행능력
`enableParallelSubagents`/`selfVerification` — 은 **현 아키텍처에서 mid-session 재적용이 불가**하다.
PRESET-014 타당성 조사(설계 §7.1)에서 분리된 연기 에픽이다.

**불가 원인(조사 결과):**

- **(B) 명령 모듈:** 모듈은 init 시 `SessionSkillRouter` 생성자에서 `commandModules.flatMap(m =>
m.systemCommands)`로 **평탄화**되어 `SystemCommandExecutor`에 정적으로 들어간다. 원본 모듈 참조는 폐기되고,
  세션 런타임에 레지스트리 변경 seam이 없다(`CommandRegistry.addModule`/`replaceSource`는 TUI 측에만 존재).
  mid-session 재선택은 모듈 목록을 세션에 보존 + `setCommandModules` 신규 메서드 + `SystemCommandExecutor`
  재생성/변경 인터페이스가 선행해야 한다.
- **(C) 실행능력:** `enableParallelSubagents`는 조립 시 `enableAgentRuntime`을 켜서 `SubagentManager`/
  백그라운드 태스크 인프라를 **세션 deps에 구워** 넣는다(런타임 setter 없음 → 부분 재조립 필요).
  `selfVerification`은 타입만 선언되고 **executor 소비 로직이 아직 미구현**이다.

**재현 조건:** `rg -n "setCommandModules|setExecutionCapabilities" packages/` → 0건. `ICommandSessionRuntime`/
`ICommandHostContext`에 모듈/실행능력 재적용 seam 없음.

설계 근거: [.design/preset-layer/2026-06-14/design-proposal.md](../../../.design/preset-layer/2026-06-14/design-proposal.md) §7.1 (PRESET-015 — 연기 에픽).

## Architecture Review

### Affected Scope (예상 — 승인 시 상세화)

- 명령 레지스트리 mutability: `SessionSkillRouter`/`SystemCommandExecutor`에 모듈 목록 보존 + 재등록 seam,
  `InteractiveSession`에 `setCommandModules`, (해당 시) TUI `CommandRegistry` 동기화
- agent runtime 재조립: `enableParallelSubagents` 토글 시 `SubagentManager`/백그라운드 인프라 teardown+rebuild
  또는 항상 구성 후 활성 플래그로 게이팅하는 방향 검토
- `selfVerification`: executor 훅에 실제 자기검증 단계 구현 + 런타임 토글
- 상위 소비: PRESET-006 `/preset <id>`가 `applyPresetToSession`을 통해 본 그룹까지 재적용

### Alternatives Considered (개요 — 승인 시 확정)

1. **모듈/실행능력을 전환 시 무시(현 상태).** Pro: 비용 0. Con: 전환의 행동 차이 중 모듈/병렬성/자기검증이
   라이브 반영 안 됨 — 풀 라이브 전환 미완.
2. **항상 구성 + 활성 플래그 게이팅(runtime gate).** Pro: 재조립 회피. Con: 항상 인프라 구성 비용; selfVerification
   구현 선행.
3. **mid-session 부분 재조립(teardown+rebuild).** Pro: 정확. Con: 복잡·위험(상태/구독 재배선).

### Decision

**연기.** PRESET-006(UX) 착지 후 별도 작업으로 상세 설계·승인을 거쳐 진행한다. PRESET-011~014로 권한·모델/
effort·페르소나 라이브 전환이 이미 동작하므로, 본 에픽 없이도 `/preset` 전환은 의미 있는 행동 차이를 만든다.
모듈/실행능력은 가치 대비 아키텍처 비용이 커 별도 계층 작업으로 분리한다(피드백: 범위가 크면 별도 FLOW로 분산).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-framework(레지스트리/런타임/executor), agent-transport(레지스트리 동기화)
- [x] Sibling scan 완료 — PRESET-012/013/014 `applyPresetToSession` 그룹 재적용 패턴 확인(본 에픽도 동일 오케스트레이터 확장)
- [x] 대안 최소 2개 검토 완료 — 3개(무시 / 게이팅 / 재조립)
- [x] 결정 근거 문서화 완료 — 연기 사유(가치 대비 비용 + 선행 아키텍처) 기록

## Solution (승인 시 확정)

PRESET-006 착지 후 착수. 명령 레지스트리 mutability seam → `applyPresetToSession`에 모듈 그룹 추가 →
실행능력(게이팅 또는 재조립) + `selfVerification` 구현 → 오케스트레이터에 능력 그룹 추가. 각 하위 작업은
승인 시 별도 백로그로 더 분해할 수 있다.

## Affected Files (승인 시 확정)

- 미확정 — GATE-WRITE/APPROVAL에서 상세화

## Completion Criteria (승인 시 확정)

- [ ] TC-01: (확정 예정) 모듈 재선택 라이브 재적용 단언
- [ ] TC-02: (확정 예정) 실행능력 재적용/게이팅 단언
- [ ] TC-03: (확정 예정) `selfVerification` 소비 로직 단언

## Test Plan

승인 시 확정. 본 문서는 연기 에픽의 **placeholder**로, PRESET-006 착지 후 GATE-WRITE에서 Completion
Criteria/Test Plan/Affected Files를 구체화한다.

## Tasks

- [ ] 미생성 — 본 에픽은 backlog 상태(연기). PRESET-006 착지 후 draft로 승격해 상세화.

## Evidence Log
