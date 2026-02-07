---
title: "프로젝트 용어집"
description: "프로젝트 전체에서 사용하는 용어와 정의의 단일 기준"
---

# 프로젝트 용어집

> 이 문서는 프로젝트 전반의 **용어 정의 단일 기준(SSOT)** 입니다.  
> 다른 문서/규칙/스킬에서 **용어 설명을 중복하지 않습니다**.

## 기준 원칙
- **도메인 개념**과 **UI 표현**을 분리한다.
  - 도메인(워크플로): Airflow 기준 용어 사용
  - UI(시각화): Graph/Node/Edge 용어 사용
- UI의 “Graph/Node/Edge”는 **표현 방식**이며, 도메인 용어를 대체하지 않는다.

## 도메인 용어 (Airflow 기준)

### DAG
- **의미**: 워크플로 정의 자체(Directed Acyclic Graph).

### Task
- **의미**: DAG 안의 개별 작업 단위(도메인 기본 단위).

### Task Instance
- **의미**: 특정 시점에 실행된 Task의 인스턴스.

### DAG Run
- **의미**: DAG의 1회 실행 단위.

### Workflow
- **의미**: DAG를 기반으로 한 실행 흐름의 전체 구조.

## UI 용어 (시각화)

### Workflow Graph
- **의미**: UI에서 표현되는 워크플로 구조(노드/엣지로 구성).
- **용도**: 시각화/분석/연결 상태 검증.

### Node
- **의미**: UI 상에서 Task(또는 Task Instance)를 표현하는 시각적 요소.

### Edge
- **의미**: UI 상에서 노드 간의 연결 관계를 표현하는 시각적 요소.

## 구성요소/역할 용어

### Workflow Builder
- **의미**: 이벤트 스트림을 받아 워크플로 그래프를 구성/갱신하는 빌더 역할(구현체 무관).

### Event Subscriber
- **의미**: 이벤트 스트림을 수신하여 빌더에 전달하는 역할.

### Explicit Linkage Fields
- **의미**: 연결을 결정하기 위한 **명시적 필드**(예: `executionId`, `parentExecutionId`, `rootExecutionId`, `path`).

## 혼용 용어 현황 (유의어 매핑)
아래 용어는 **현재 혼용되는 표현**이며, 점진적으로 Airflow 기준으로 수렴한다.

| 현재 혼용 표현 | 표준 용어(목표) | 비고 |
| --- | --- | --- |
| workflow / graph | DAG / Workflow Graph | 도메인 vs UI 구분 |
| node | task | 도메인은 task, UI는 node |
| edge | dependency / edge | 도메인은 dependency, UI는 edge |
| execution | DAG Run | 도메인 실행 단위는 DAG Run |
| job / step | task | task로 통일 |

## 점진적 전환 가이드
- 새 문서/설명에는 **표준 용어만** 사용한다.
- 기존 문서/코드는 **차후 수정 시** 표준 용어로 치환한다.
- UI 문맥에서는 Graph/Node/Edge를 유지하되, 도메인 설명과 혼용하지 않는다.
