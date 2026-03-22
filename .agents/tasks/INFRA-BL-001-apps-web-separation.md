---
title: apps/web 목적별 분리 — dag-designer 전용 앱
status: backlog
created: 2026-03-15
priority: medium
---

## 문제

현재 `apps/web`이 하나에 모든 것을 담고 있어서 목적이 불명확.

- `/dag-designer` — DAG 디자이너
- `/playground` — AI Agent 플레이그라운드
- `/dag-designer/cost-management` — 비용 관리

서로 다른 사용자/목적의 기능이 하나의 앱에 혼재.

## 방향

목적별로 앱을 분리:

```
apps/
├── dag-studio/          # DAG 디자이너 + 비용 관리 + 워크플로우 관리
├── agent-playground/    # AI Agent 플레이그라운드 (기존 playground)
└── web/                 # 랜딩/포털 (선택적)
```

## dag-studio 앱 (신규)

- dag-designer 캔버스
- 비용 관리 (cost-management)
- DAG 목록/관리
- Publish 관리
- 향후: AI 채팅 DAG 구성
