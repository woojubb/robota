---
title: 서버리스 배포 아키텍처 — 보류
status: backlog
priority: low
created: 2026-03-26
packages:
  - agent-sdk
  - agent-transport-http
---

## 요약

CF Dynamic Workers, AWS Lambda 등 서버리스 환경에 에이전트를 배포하는 앱 구조 설계.

## 보류 사유 (2026-03-26)

CF Dynamic Workers는 V8 isolate 기반으로 `child_process` 불가. bash, git, gh 등 네이티브 바이너리 실행이 안 됨. 우리 에이전트가 `bashTool`을 핵심 도구로 사용하므로 Dynamic Workers 단독으로는 부족.

## 결론

- CF Dynamic Workers: bash 불가 → 풀 코딩 에이전트에 부적합. 코드 편집/리뷰 전용이라면 가능
- AWS Lambda: child_process 가능하나 아직 구현 미착수
- 하이브리드 (Dynamic Workers + Containers): 검토 필요하나 복잡도 높음

## 재개 조건

- CF Containers가 GA되어 Dynamic Workers와 연동 가능해질 때
- 또는 bash 없는 에이전트 유스케이스가 명확해질 때
- 또는 Lambda 배포가 구체적으로 필요해질 때

## 관련 문서

- `.design/agent-transport-architecture.md`
- `.agents/tasks/INFRA-BL-002-deployment-architecture.md`
