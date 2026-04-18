---
title: Agent 워크스페이스 Manifest
status: backlog
created: 2026-04-19
priority: low
urgency: later
depends_on: INFRA-BL-002
---

## What

에이전트 실행 환경(파일, Git 저장소, 스토리지 마운트, 권한)을 선언적 Manifest 파일 하나로 정의한다.

어디서 실행되든(로컬, Lambda, Fly.io) 동일한 워크스페이스를 재현할 수 있게 한다.

## 배경

OpenAI Agents SDK (2026년 4월)의 Manifest 개념:

- 로컬 파일 스테이징, Git 저장소 클론, S3/GCS/Azure Blob 마운트를 선언적으로 구성
- 에이전트 실행 플랫폼에 독립적인 포터블 워크스페이스 정의

## 설계 방향

```yaml
# workspace.manifest.yaml 예시
files:
  - source: ./task.md
    dest: /workspace/task.md
repos:
  - url: https://github.com/user/repo
    path: /workspace/repo
storage:
  - type: s3
    bucket: my-bucket
    mount: /workspace/data
permissions:
  read: [/workspace]
  write: [/workspace/output]
```

CLI 사용 예:

```bash
robota -p "$(cat task.md)" --manifest workspace.manifest.yaml
```

## 연관 작업

- **INFRA-BL-002** (선행조건) — 샌드박스 실행 환경이 먼저 구현되어야 Manifest가 의미있음
- **SDK-BL-004** (Ralph Loop) — 매 반복마다 Manifest로 동일한 환경 보장

## Open Design Questions

1. Manifest 파일 포맷 — YAML vs JSON vs TypeScript config
2. 로컬 실행 시 Docker 없이도 권한 제어 가능한가
3. Git 저장소 클론은 shallow clone 기본으로 할지

## Promotion Path

1. INFRA-BL-002 완료 후 진행
2. Branch: `feat/agent-workspace-manifest` (구현 시점에 생성)
