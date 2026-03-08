# ComfyUI 서버 아키텍처 분석

**Python, 2023~**

AI 이미지/비디오 생성을 위한 노드 기반 워크플로우 엔진. 브라우저 UI에서 노드를 연결하여 워크플로우를 구성하고, 서버에서 실행한다.

## 레이어 분리

```
PromptServer (aiohttp)          ← HTTP REST + WebSocket 이중 프로토콜
  │
  ├── PromptQueue (FIFO)        ← 워크플로우 큐잉
  │
  ├── prompt_worker() [데몬 스레드]
  │     │
  │     └── PromptExecutor      ← 워크플로우 실행 오케스트레이터
  │           │
  │           ├── DynamicPrompt  ← 그래프 상태 관리 (임시 노드 포함)
  │           ├── ExecutionList  ← 위상 정렬 기반 실행 순서
  │           ├── CacheSet       ← 4가지 캐싱 전략
  │           └── Node Registry  ← NODE_CLASS_MAPPINGS
  │
  └── Model Manager             ← VRAM 인식 모델 로딩/언로딩
```

- **PromptServer**: aiohttp 기반 비동기 웹 서버. HTTP + WebSocket 이중 프로토콜.
- **PromptQueue**: FIFO 큐. 데몬 스레드가 폴링하여 실행 엔진에 전달.
- **PromptExecutor**: 워크플로우 실행 전체 수명주기 조율. DynamicPrompt 생성 → ExecutionList로 위상 정렬 → 노드 순회 실행.
- **prompt_worker()**: 데몬 스레드. 큐에서 항목 추출 → execute() 호출 → GC 처리 → WebSocket 완료 이벤트.

**특징**: 레이어 분리가 암묵적. 클래스 간 직접 참조가 많고, 포트/어댑터 같은 추상화 없음. 단일 프로세스 내에서 동작.

## DAG/워크플로우 정의 모델

JSON 워크플로우 — 노드 + 링크로 구성. UI에서 편집 → JSON 직렬화.

**API 포맷** (서버 실행용):
```json
{
  "5": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["4", 0],
      "positive": ["6", 0],
      "seed": 8566257,
      "steps": 20
    }
  }
}
```

**UI 포맷** (별도 구조):
- 6요소 배열 링크: `[link_id, source_node_id, source_output_index, dest_node_id, dest_input_index, data_type]`
- API 포맷과 분리. 서버는 API 포맷만 사용.

버전 관리, 상태(draft/published) 개념 없음. 워크플로우는 제출 시 그대로 실행.

## 노드/태스크 모델

Python 클래스 기반. `NODE_CLASS_MAPPINGS` 딕셔너리에 등록.

### 필수 속성

| 속성 | 역할 | 예시 |
|------|------|------|
| `INPUT_TYPES()` | 입력 포트 정의 (classmethod) | `{"required": {"image": ("IMAGE",)}}` |
| `RETURN_TYPES` | 출력 타입 튜플 | `("IMAGE",)` |
| `FUNCTION` | 실행 메서드명 문자열 | `"execute"` |
| `CATEGORY` | UI 메뉴 분류 | `"image/transform"` |

### 입력 카테고리

- `"required"`: 필수 입력
- `"optional"`: 선택적 입력
- `"hidden"`: UI 비노출 (PROMPT, DYNPROMPT, UNIQUE_ID 등 시스템 주입)

### 타입 시스템

문자열 기반 타입 식별자: `MODEL`, `CLIP`, `VAE`, `CONDITIONING`, `LATENT`, `IMAGE`, `MASK`, `STRING`, `INT`, `FLOAT` 등.

- 컴파일 타임 타입 검증 없음 (Python 런타임 검증)
- 호환성은 UI 레벨에서 문자열 매칭으로 검증
- 커스텀 타입 자유롭게 정의 가능 (단순 문자열)

### 노드 로딩 3단계

1. 핵심 노드 (`nodes.py`)
2. 확장 노드 (`comfy_extras/`)
3. 커뮤니티 노드 (`custom_nodes/`)

### Lazy 입력

```python
@classmethod
def INPUT_TYPES(cls):
    return {"required": {
        "condition": ("BOOLEAN",),
        "image_true": ("IMAGE", {"lazy": True}),
        "image_false": ("IMAGE", {"lazy": True}),
    }}
```

`check_lazy_status()` 메서드로 실제 필요한 입력만 평가. 조건부 분기의 불필요한 연산 방지.

## 실행 모델

### Kahn 알고리즘 기반 위상 정렬

1. 각 노드의 진입 차수(in-degree) 계산
2. 진입 차수 0인 노드를 큐에 삽입
3. 큐에서 꺼내 처리 → 의존 노드의 진입 차수 감소
4. 모든 입력 준비 후에만 노드 실행 보장

**실행 모델 반전 (PR #2666)**:
- 기존: 뒤에서 앞으로(back-to-front) 재귀 호출
- 현재: 앞에서 뒤로(front-to-back) 위상 정렬
- 실행 중 그래프 수정 가능 (동적 노드 확장, 지연 평가)

### 단일 워커

- 데몬 스레드 1개가 PromptQueue에서 순차적으로 dequeue → execute
- 분산 워커, 병렬 노드 실행 없음
- 모델 상태 공유 때문에 의도적으로 단일 스레드

### 노드 실행 절차

1. `NODE_CLASS_MAPPINGS`에서 클래스 인스턴스화
2. `get_input_data()`로 입력 해석 (링크 해석, 상수 통과, 숨겨진 입력 주입)
3. `check_lazy_status()` 확인 (lazy 입력 평가 여부)
4. `map_node_over_list()`로 지정 함수 호출
5. async/coroutine 반환값 처리
6. 출력 캐싱 및 실행 상태 업데이트

### 동적 노드 확장 (Node Expansion)

`DynamicPrompt`를 통해 실행 중 그래프 구조 변경:
- 노드의 `FUNCTION`이 서브그래프를 반환하면 DynamicPrompt가 임시(ephemeral) 노드로 등록
- While 루프, 컴포넌트 등 고급 제어 흐름 구현 가능

### ExecutionBlocker

- 입력으로 `ExecutionBlocker`를 받으면 실행 건너뛰고 모든 출력에 전파
- `ExecutionBlocker(None)`: 조용히 차단 (정상 흐름)
- `ExecutionBlocker("error message")`: 오류 메시지와 함께 차단
- 조건부 실행 제어의 핵심 메커니즘

## 데이터 흐름

### 링크 구조

API 포맷에서 링크 = `[source_node_id: string, output_index: int]`:

```json
"model": ["4", 0]    // 노드 "4"의 RETURN_TYPES 중 인덱스 0번 출력
```

### 입력 해석 (`get_input_data()`)

- 배열이면 링크 → 상위 노드의 캐시된 출력에서 해당 인덱스 값 추출
- 스칼라면 상수 → 그대로 전달
- 숨겨진 입력 → 시스템 자동 주입

### 데이터 타입

주로 PyTorch 텐서:
- `IMAGE`: `[B, H, W, C]` float32 텐서 (0~1 범위)
- `LATENT`: `{"samples": tensor}` 딕셔너리
- `MODEL`: `ModelPatcher` 인스턴스 (가중치 패치 래퍼)
- 기본형: `STRING`, `INT`, `FLOAT`

노드 간 데이터가 메모리에서 직접 전달 (직렬화 없음). 단일 프로세스이므로 가능.

## 상태 관리

명시적 상태 머신 없음. WebSocket 이벤트 시퀀스로 암묵적 추적:

```
execution_start → [execution_cached] → executing(node1) → progress* →
executed(node1) → executing(node2) → ... → executing(null) → execution_success
```

- 런/태스크 상태를 저장하는 DB나 자료구조 없음
- 실행 중인 prompt_id와 큐 상태만 관리
- 실행 완료 후 히스토리에 결과 저장 (인메모리)

## 스토리지/영속성

파일시스템 기반. 메타데이터 DB 없음.

| 대상 | 저장 방식 |
|------|----------|
| 출력 이미지 | `output/` 디렉토리에 파일 저장 |
| 임시 이미지 | `temp/` 디렉토리 (프리뷰 등) |
| 입력 이미지 | `input/` 디렉토리 |
| 실행 히스토리 | 인메모리 딕셔너리 (서버 재시작 시 유실) |
| 워크플로우 정의 | 클라이언트 로컬 저장 (서버에 영속적 저장 없음) |
| 모델 가중치 | `models/` 하위 디렉토리 |

## 서버 API

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/prompt` | POST | 워크플로우 제출. 검증 후 큐 적재. 반환: `{prompt_id, number}` |
| `/prompt` | GET | 현재 큐 상태 |
| `/queue` | GET | 실행 중 + 대기 중 항목 |
| `/queue` | POST | 큐 관리 (삭제/초기화) |
| `/history` | GET | 실행 히스토리 |
| `/history/{prompt_id}` | GET | 특정 실행 결과 |
| `/object_info` | GET | 전체 노드 클래스 라이브러리 (입력, 출력, 기본값, 문서) |
| `/object_info/{node_class}` | GET | 특정 노드 클래스 정보 |
| `/system_stats` | GET | 시스템 통계 (VRAM, RAM, GPU) |
| `/view` | GET | 이미지 조회 |
| `/upload/image` | POST | 이미지 업로드 (multipart/form-data) |
| `/interrupt` | POST | 현재 실행 중단 |
| `/free` | POST | 메모리 해제 (모델 언로드) |
| `/ws` | WebSocket | 실시간 양방향 통신 |

모든 엔드포인트는 `/api` 접두사로도 접근 가능.

## 이벤트/진행 보고

WebSocket 양방향 통신. 연결: `ws://server:8188/ws?clientId={sid}`

### 이벤트 타입

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `status` | `{exec_info: {queue_remaining: N}}` | 큐 상태 |
| `execution_start` | `{prompt_id}` | 실행 시작 |
| `execution_cached` | `{nodes: [id, ...], prompt_id}` | 캐시 히트 노드 목록 |
| `executing` | `{node: "id", prompt_id}` | 현재 실행 중 노드 (`null`이면 완료) |
| `progress` | `{value: N, max: M, prompt_id, node}` | 샘플링 진행률 |
| `executed` | `{node: "id", output: {...}, prompt_id}` | 노드 완료 및 출력 |
| `execution_error` | `{prompt_id, node_id, exception_message}` | 실행 오류 |
| `execution_success` | `{prompt_id}` | 전체 실행 성공 |

프로그레스 이미지 프리뷰는 **바이너리 WebSocket 메시지**로 전송 (JSON이 아닌 raw bytes).

## 에러 처리 & 재시도

- **재시도 없음**. 실패 시 워크플로우 중단.
- `/interrupt` 엔드포인트로 수동 중단 가능.
- `execution_error` WebSocket 이벤트로 오류 상세 전달.
- 노드 레벨 에러 격리 없음 — 한 노드 실패 시 전체 워크플로우 중단.
- DLQ, 재시도 정책, 상태 복구 개념 없음.

## 캐싱

4가지 전략으로 구성된 `CacheSet`:

| 전략 | CLI 플래그 | 특성 |
|------|-----------|------|
| **CLASSIC** | `--cache-classic` (기본) | 제거 없음. 무제한 메모리 성장. 최대 성능 |
| **LRU** | `--cache-lru N` | 고정 크기. 용량 초과 시 LRU 제거 |
| **RAM_PRESSURE** | `--cache-ram [GB]` | 시스템 RAM 가용량 모니터링. 큰 항목부터 제거. 기본 여유: 4GB |
| **NONE** | `--cache-none` | 캐싱 비활성화. 모든 노드 재실행. 디버깅용 |

### 캐시 구조

- 이중 캐시: `outputs` (노드 실행 결과) + `objects` (노드 인스턴스)
- 캐시 키: 입력 시그니처 기반 → 동일 입력이면 다른 워크플로우에서도 재사용 가능
- 캐시 히트 시 노드 실행 완전 우회, O(1) 검색

### 캐시 수명주기

- 실행 전: `set_prompt()`로 IS_CHANGED 캐시 설정 → `clean_unused()`로 현재 프롬프트에 없는 캐시 제거
- 서브그래프 관리: 임시 노드가 생성하는 하위 캐시는 부모 노드에 스코핑

## 특이점

### VRAM 인식 모델 관리

6가지 VRAM 운영 모드 (DISABLED, NO_VRAM, LOW_VRAM, NORMAL_VRAM, HIGH_VRAM, SHARED).

**ModelPatcher 패턴**:
- 기본 모델 가중치를 즉시 수정하지 않음
- 패치를 딕셔너리에 축적 → GPU 로딩 시점에 일괄 적용
- `Base Model (frozen) → ModelPatcher (patches) → patch_model() → Patched Model (GPU)`
- LoRA, ControlNet 등 다중 수정사항 효율적 적용

**메모리 인식 제거**:
- LRU 기반 모델 언로딩. 사용 타임스탬프 추적.
- 충분한 메모리 확보될 때까지 가장 오래 미사용 모델부터 제거
- 현재 파이프라인에 필요한 모델은 보존

### 설계 철학

- **단순성 우선**: 상태 머신, 분산 시스템, 복잡한 추상화 없이 직접적인 구현
- **GPU 메모리 최적화**: 모든 설계 결정이 VRAM 효율성 중심
- **실시간 피드백**: WebSocket으로 샘플링 진행률과 프리뷰 이미지 즉시 전달
- **확장성**: NODE_CLASS_MAPPINGS 딕셔너리 하나로 커스텀 노드 무제한 추가
