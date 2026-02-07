---
title: "스킬 디렉터리 정리"
description: "프로젝트 스킬의 분류 기준과 위치를 정의한다"
---

# 스킬 디렉터리 정리

## 목적
- rules의 강제 규칙과 skills의 절차/가이드를 분리한다.
- 스킬을 목적 기반으로 분류해 탐색성과 유지보수성을 높인다.

## 위치
- 프로젝트 스킬: `.cursor/skills/<skill-name>/SKILL.md`

## 분류 기준
- **운영/절차**: 반복 작업 흐름, 실행 가이드, 체크리스트
- **도메인 가이드**: 특정 패키지/기능 사용 패턴
- **검증/디버깅**: 문제 진단 절차와 조건
- **작성 규칙 보조**: 규칙을 보완하는 작성 가이드(예시/질문/템플릿)

## 네이밍 규칙
- 소문자 + 하이픈 사용
- 범용 용어 우선, 특정 디렉터리/파일명 포함 지양
- 예: `execution-caching`, `execution-cache-ops`, `workflow-edge-debugging`, `ssot-change-workflow`, `workflow-determinism-guidance`

## 운영 원칙
- rules의 강제 규칙은 스킬로 옮기지 않는다.
- 스킬은 절차/가이드 중심으로 구성한다.
- 스킬 간 중복이 생기면 통합을 우선 검토한다.

## 상태
- rules → skills 전환 완료 상태는 문서/스킬/README에 분산 반영한다.
