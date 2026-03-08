# DAG 벤치마킹 리서치

## 목적

Robota 모노레포의 `packages/dag-*` 패키지들(9개)의 계약 관계와 구현 정확도를 점검하기 위해, 유명 오픈소스 DAG/워크플로우 솔루션의 서버 구현 레이어를 벤치마킹하여 문서화한다.

## 비교 대상 솔루션

| 솔루션 | 언어 | 시작 연도 | 특성 |
|--------|------|-----------|------|
| Apache Airflow | Python | 2014 | 데이터 파이프라인의 사실상 표준. Airflow 3.0(2025.04)으로 대규모 아키텍처 전환 |
| ComfyUI | Python | 2023 | AI 이미지 생성 워크플로우. 노드 기반 UI, WebSocket 실시간 스트리밍, 캐싱 전략 |
| Dagster | Python | 2019 | 자산 중심(Asset-Centric) 패러다임. IO Manager, 타입 시스템, 이벤트 로그 |
| Prefect | Python | 2018 | "Negative Engineering" 철학. DAG 강제 없음, 네이티브 Python 흐름 |
| n8n | TypeScript | 2019 | Robota와 동일 기술 스택. 200+ 통합, Bull Queue 분산 실행, AI 에이전트 루프 |

## 비교 축

1. **레이어 분리** — 아키텍처 레이어 구성과 분리 방식
2. **DAG/워크플로우 정의 모델** — 정의 방식 (코드 vs JSON vs UI)
3. **노드/태스크 모델** — 처리 단위의 정의, 등록, 타입 시스템
4. **실행 모델** — 그래프 순회, 태스크 디스패치, 워커 구조
5. **데이터 흐름** — 노드 간 데이터 전달 방식
6. **상태 관리** — 실행 상태 추적, 상태 머신
7. **스토리지/영속성** — 런 메타데이터, 결과 저장
8. **서버 API** — CRUD, 실행 제어, 진행 상황 조회
9. **이벤트/진행 보고** — 실시간 진행 상황 전달 방식
10. **에러 처리 & 재시도** — 실패 복구, DLQ, 재시도 정책
11. **캐싱** — 실행 결과 캐싱 전략

## 문서 구성

| 파일 | 내용 |
|------|------|
| `01-architecture-comparison.md` | 11개 비교 축별 대조표 |
| `02-airflow.md` | Apache Airflow 상세 분석 |
| `03-comfyui.md` | ComfyUI 상세 분석 |
| `04-dagster.md` | Dagster 상세 분석 |
| `05-prefect.md` | Prefect 상세 분석 |
| `06-n8n.md` | n8n 상세 분석 |
| `07-robota-current-state.md` | Robota DAG 현황 정리 |
| `08-gap-analysis.md` | 비교 분석 및 갭 평가 (드래프트) |

## 범위

- 이 리서치는 **서버 사이드 구현 레이어**에 집중한다.
- 기존 `packages/*/docs/SPEC.md`는 변경하지 않는다.
- 개선 제안은 `08-gap-analysis.md`에 드래프트로만 작성하며, 실제 적용은 별도 승인 후 진행한다.
