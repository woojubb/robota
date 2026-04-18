---
title: Agent 워크스페이스 스냅샷/하이드레이션
status: backlog
created: 2026-04-19
priority: low
urgency: later
depends_on: INFRA-BL-002, INFRA-BL-003
---

## What

에이전트 실행 중 워크스페이스 전체 상태를 스냅샷으로 저장하고, 중단된 실행을 스냅샷에서 그대로 복원(하이드레이션)해 재개한다.

현재 Robota의 `--resume`(세션 히스토리 재개)과는 다른 개념:

- 기존 `--resume`: 대화 컨텍스트(메시지 히스토리) 복구
- 이 기능: 실행 환경(워크스페이스 파일, 툴 실행 상태) 복구

## 배경

OpenAI Agents SDK (2026년 4월)의 스냅샷/하이드레이션:

- 장시간 실행 에이전트가 중단되더라도 처음부터 재시작 불필요
- 워크스페이스 상태 전체를 저장 후 복원

## CLI 사용 예

```bash
# 실행 중 스냅샷 ID 출력
robota -p "$(cat task.md)" --snapshot-on-exit
# → Snapshot saved: snap_abc123

# 스냅샷에서 재개
robota --resume-snapshot snap_abc123
```

## 연관 작업

- **INFRA-BL-002** (선행조건) — 샌드박스가 있어야 워크스페이스 경계가 명확
- **INFRA-BL-003** (선행조건) — Manifest로 정의된 워크스페이스를 스냅샷 단위로 저장
- **SDK-BL-004** (Ralph Loop) — 실패한 반복을 스냅샷에서 재시도 가능

## Open Design Questions

1. 스냅샷 저장소 — 로컬 파일시스템 vs S3/GCS
2. 스냅샷 단위 — 전체 워크스페이스 vs 변경분(diff)만
3. 기존 `--resume`(세션 히스토리)과 통합할지 분리할지

## Promotion Path

1. INFRA-BL-002, INFRA-BL-003 완료 후 진행
2. Branch: `feat/agent-snapshot-hydration` (구현 시점에 생성)
