# DAG 비용 추정 리서치

## 목적

DAG 실행 전 비용 예측 기능을 설계하기 위해, 업계 주요 오케스트레이션 시스템과 AI 워크플로우 플랫폼의 비용 계산 방식을 조사한다. 특히 Weavy.ai(노드 기반 AI 워크플로우 플랫폼)를 중점 분석하여 Robota 오케스트레이터 레벨 비용 추정 설계에 참고한다.

---

## 1. Weavy.ai 분석

### 1.1 서비스 개요

Weavy.ai는 크리에이티브 전문가를 위한 **노드 기반 AI 워크플로우 플랫폼**이다. Figma가 인수했으며, 여러 AI 모델(GPT Image, Stable Diffusion 3.5, Runway Gen-4, Imagen 3, Flux Pro, Recraft V3 등)과 전문 편집 도구(blur, crop, inpaint, mask, upscale, relight, outpaint)를 하나의 비주얼 캔버스에서 결합한다.

**아키텍처 특성:**
- 노드 기반 워크플로우 빌더 — 사용자가 노드(생성 AI 노드, 편집 도구)를 파이프라인으로 연결
- 포트 타입 색상 코딩: 초록=이미지, 보라=텍스트, 빨강=비디오, 파랑=배열/3D, 라임=마스크
- "App Mode"로 복잡한 워크플로우를 비기술 팀원용 단순 UI로 변환

### 1.2 과금 모델: 구독 + 크레딧 하이브리드

#### 구독 플랜

| 플랜 | 월 요금 | 연간 요금 | 월 크레딧 | 워크플로우 수 |
|------|---------|-----------|-----------|-------------|
| Free | $0 | — | 150 | 5개 |
| Starter | $24 | $228/년 | 1,500 | 무제한 |
| Professional | $45 | $432/년 | 4,000 | 무제한 |
| Team | $60/인 | $576/인/년 | 4,500/인 | 무제한 |
| Enterprise | 협의 | 협의 | 협의 | 무제한 |

#### 크레딧 추가 구매

- Starter: $10 / 1,000 크레딧
- Professional/Team: $10 / 1,200 크레딧
- 추가 구매 크레딧은 12개월 이월

#### 크레딧 이월 정책

- Free/Starter: 매월 리셋, 이월 없음
- Professional/Team: 미사용 크레딧 최대 3개월 이월 (월 할당량의 3배까지)

### 1.3 크레딧 계산 방식

**토큰 기반이 아님.** Weavy는 **크레딧 추상화** 방식을 사용한다.

```
노드 크레딧 = f(AI 모델 종류, 해상도, 영상 길이, 품질 모드)
```

#### 비용 결정 요소

| 요소 | 반영 여부 | 설명 |
|------|----------|------|
| AI 모델 종류 | O | 모델별 고정 크레딧 (Flux Fast < Flux Pro < Veo 3) |
| 출력 해상도 | O | 고해상도일수록 높은 크레딧 |
| 영상 길이(초) | O | 긴 영상일수록 높은 크레딧 |
| 품질 모드 | O | 고품질 모드일수록 높은 크레딧 |
| 프롬프트 길이/토큰 수 | X | 반영하지 않음 |
| Input 이미지 복잡도 | X | 반영하지 않음 |

#### 노드 유형별 과금

| 노드 유형 | 크레딧 | 설명 |
|-----------|--------|------|
| **생성 AI 노드** | 모델별 상이 (1~500+) | GPT Image, Flux, Runway 등 AI 추론 노드 |
| **비생성 노드** | 무료 (0 크레딧) | blur, crop, 합성, 페인팅 등 편집 도구 |

#### 크레딧이 커버하는 것

> "Credits help cover licensing and cloud costs of AI models"

크레딧은 단순 AI API 비용뿐 아니라 **GPU 클라우드 비용, 라이선싱 비용**을 모두 포함하는 추상화 단위다. 사용자에게는 내부 비용 분해를 노출하지 않고 단일 크레딧 숫자만 보여준다.

### 1.4 Weavy에 없는 기능 (Robota 차별화 기회)

| 기능 | Weavy 상태 | Robota 기회 |
|------|-----------|------------|
| **워크플로우 전체 사전 비용 추정** | 없음 (노드 단위만) | DAG 전체 비용 예측 후 실행 결정 |
| **실행 후 비용 분석** | 없음 | 워크플로우별 비용 추적/리포팅 |
| **동적 input 기반 비용 조정** | 없음 (고정 크레딧) | input 데이터 기반 동적 추정 |
| **예산 한도 제어** | 없음 | 비용 한도 초과 시 실행 차단 |

---

## 2. 업계 DAG 시스템 비용 추정 비교

### 2.1 오케스트레이션 시스템

| 시스템 | 사전 추정 | 실행 중 제어 | 사후 계산 | 비용 메타데이터 |
|--------|----------|------------|----------|---------------|
| **Apache Airflow** | 없음 | 없음 | callback으로 수동 | `pre_execute`/`post_execute` 훅 |
| **Dagster** | 과거 데이터 기반 예측 | 없음 | asset metadata × 단가 | `MaterializeResult` 메타데이터 |
| **Temporal** | 없음 | Saga 보상 패턴 | 플랫폼 레벨 과금 | Actions 기반 ($25/백만) |
| **Argo Workflows** | 없음 | timeout만 | `resourceDuration` | CPU/메모리 초 단위 |
| **AWS Step Functions** | 정적 공식 | 없음 | CloudWatch | 상태 전이 × $0.000025 |
| **Vertex AI** | Pricing Calculator | 없음 | billing label + BigQuery | 자동 billing label |
| **Prefect** | 없음 | 없음 | 없음 | 좌석 기반 과금 |

### 2.2 LLM 프레임워크

| 프레임워크 | 사전 추정 | 예산 제어 | 특징 |
|-----------|----------|----------|------|
| **LlamaIndex** | MockLLM 시뮬레이션 | 없음 | max_tokens 가정으로 상한 추정 |
| **LangChain** | 없음 | 없음 | `get_openai_callback()` 사후 토큰 카운팅 |
| **LiteLLM** | 없음 | **프록시 레벨 예산 차단** | Org > Team > User > Key 계층적 예산 |

### 2.3 ComfyUI 생태계

- **Comfy Cloud**: GPU 워크플로우 0.39 크레딧/초, API 노드는 프로바이더별 토큰 과금
- **JNodes Token Counter**: T5XXL, CLIP 인코더 토큰 카운팅 커스텀 노드
- **워크플로우 레벨 비용 추정/예산 제어**: 오픈소스 생태계에 존재하지 않음

---

## 3. 핵심 패턴 분석

### 3.1 업계에서 사용하는 5가지 패턴

#### Pattern A: 사후 계산 (Post-Calculate Only) — 가장 보편적

**사용:** Airflow, Temporal, Argo, Kubeflow, MLflow, LangChain

워크플로우를 실행하고, 리소스 소비(토큰, CPU초, 상태 전이)를 콜백이나 플랫폼 메트릭으로 추적한 뒤 사후 비용 리포팅. 사전 추정 없음.

#### Pattern B: 정적 사전 추정 + 사후 계산

**사용:** AWS Step Functions, Vertex AI Pipelines

워크플로우 구조(상태 전이 수 × 단가) 기반의 정적 추정. 실제 비용은 실행 후 정산. 동적 input 미반영.

#### Pattern C: 시뮬레이션 사전 추정

**사용:** LlamaIndex (MockLLM)

실제 API 호출 없이 그래프를 시뮬레이션하여 worst-case (max_tokens) 기준 상한 추정. 보수적이지만 실제 비용과 괴리 가능.

#### Pattern D: Asset 메타데이터 × 단가 (Dagster 방식)

**사용:** Dagster Insights

각 asset 실행 시 수치 메타데이터(처리 행 수, 바이트) 기록 → 단가(cost-per-unit) 곱셈으로 비용 산출. 과거 데이터로 미래 비용 예측 가능.

#### Pattern E: 프록시 레벨 예산 게이트

**사용:** LiteLLM, Azure Cost Circuit Breaker

게이트웨이/프록시가 누적 비용을 추적하고 예산 초과 시 요청 차단. 워크플로우 엔진 외부에서 작동.

### 3.2 "중간 노드 input 미지" 문제

업계에서도 이 문제를 완전히 해결한 프로덕션 시스템은 없다. 실용적 접근:

| 접근 | 방식 | 정확도 | 복잡도 |
|------|------|--------|--------|
| **Worst-case bounding** | 각 노드의 최대 output 가정 | 보수적 (과대 추정) | 낮음 |
| **Historical averaging** | 과거 실행 데이터 평균 | 안정적 파이프라인에서 높음 | 중간 |
| **Circuit breaker** | 추정 포기, 실행 중 누적 모니터링 후 차단 | N/A (사후 제어) | 중간 |
| **Progressive estimation** | 단계별로 추정 → 실행 → 재추정 | 높음 | 높음 |
| **ML 기반 예측** | GAN/GNN으로 비용 예측 | 연구 단계 | 매우 높음 |

---

## 4. Robota 시스템에 적용 가능한 시사점

### 4.1 Weavy에서 배울 점

1. **크레딧 추상화**: 내부 복잡성(GPU, API, DB)을 단일 단위로 통합하면 UX가 단순해짐
2. **2-class 노드 구분**: AI 노드(비용 발생) vs 변환 노드(무료) — 비용 추정 대상을 줄임
3. **파라미터 민감 가격**: 모델뿐 아니라 해상도, 길이 등 출력 파라미터도 반영
4. **노드별 비용 표시**: 각 노드 위에 예상 크레딧을 시각적으로 표시

### 4.2 Dagster에서 배울 점

1. **메타데이터 기반 비용 모델**: 실행 시 메타데이터(처리량) 기록 → 단가 곱셈
2. **과거 데이터 기반 예측**: 동일 파이프라인의 과거 실행 비용으로 미래 추정
3. **Insights 대시보드**: 비용 추세 시각화

### 4.3 LiteLLM에서 배울 점

1. **계층적 예산 구조**: Org > Team > User > Key별 예산 한도
2. **프록시 레벨 차단**: 예산 초과 시 요청 자체를 거부

### 4.4 Robota만의 차별화 기회

| 기능 | 업계 현황 | Robota 기회 |
|------|----------|------------|
| DAG 전체 사전 비용 추정 | 어떤 시스템에도 없음 | 실행 전 전체 비용 예측 |
| Input 기반 동적 추정 | LlamaIndex MockLLM만 (제한적) | 노드 config + input 기반 정밀 추정 |
| 추정 vs 실제 비교 | Dagster만 (제한적) | 추정/실제 차이 기록 및 공식 보정 |
| 노드별 비용 공식 레지스트리 | 없음 | 오케스트레이터 레벨 비용 공식 관리 |

---

## 참고 자료

### Weavy.ai

- [Weavy.ai 홈페이지](https://www.weavy.ai/)
- [Weavy Pricing](https://www.weavy.ai/pricing)
- [Weavy Credit System](https://help.weavy.ai/en/articles/12267166-weavy-s-credit-system)
- [Weavy Subscription Plans](https://help.weavy.ai/en/articles/12267070-weavy-s-subscription-plans)
- [Understanding Nodes](https://help.weavy.ai/en/articles/12292386-understanding-nodes)

### 업계 시스템

- [Airflow Cluster Policies & Task Callbacks](https://medium.com/apache-airflow/how-to-track-metadata-with-airflow-cluster-policies-and-task-callbacks-f80d42db9895)
- [Dagster Cost Insights](https://dagster.io/platform-overview/cost-insights)
- [Dagster Asset Metadata](https://docs.dagster.io/guides/build/assets/metadata-and-tags)
- [Temporal Cloud Pricing](https://docs.temporal.io/cloud/pricing)
- [Argo Workflows Cost Optimization](https://argo-workflows.readthedocs.io/en/latest/cost-optimisation/)
- [Argo Workflows Resource Duration](https://argo-workflows.readthedocs.io/en/latest/resource-duration/)
- [AWS Step Functions Pricing](https://aws.amazon.com/step-functions/pricing/)
- [Vertex AI Pipeline Cost Labels](https://cloud.google.com/vertex-ai/docs/pipelines/understand-pipeline-cost-labels)

### LLM 프레임워크

- [LlamaIndex Cost Analysis](https://developers.llamaindex.ai/python/framework/understanding/evaluating/cost_analysis/)
- [LangChain Cost Tracking (LangSmith)](https://docs.langchain.com/langsmith/cost-tracking)
- [LiteLLM Budget Manager](https://docs.litellm.ai/docs/budget_manager)
- [LiteLLM Spend Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)

### ComfyUI

- [ComfyUI Partner Nodes Pricing](https://docs.comfy.org/tutorials/partner-nodes/pricing)
- [ComfyUI Custom Nodes Token Counters](https://medium.com/@yushantripleseven/comfyui-custom-nodes-token-counters-etc-6820cb0ef4bc)

### 학술 연구

- [GATES: Cost-aware Dynamic Workflow Scheduling (arXiv 2025)](https://arxiv.org/html/2505.12355v3)
- [Cost-aware DAG Scheduling Algorithms (Springer)](https://link.springer.com/article/10.1007/s11227-016-1637-7)
