# ComfyUI 동적/가변 Input 리서치

## 목적

DAG JSON에서 input/output을 제거하는 리팩토링을 위해, ComfyUI가 가변 개수 input을 어떻게 처리하는지 조사한다. 우리 시스템의 `isList` 포트와 ComfyUI의 호환성을 확인한다.

---

## 1. 핵심 규칙: 하나의 input key = 하나의 링크

ComfyUI의 prompt JSON에서 **하나의 input key는 하나의 값 또는 하나의 링크만** 받는다.

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["1", 0],
      "positive": ["2", 0],
      "latent_image": ["4", 0]
    }
  }
}
```

`"images": [["nodeA", 0], ["nodeB", 0]]` 같은 배열 링크는 **불가능**하다.

---

## 2. 가변 개수 Input 처리 방식

### 방식 A: 고정 Input (ImageBatch — deprecated)

```python
class ImageBatch:
    INPUT_TYPES = {
        "required": {
            "image1": ("IMAGE",),
            "image2": ("IMAGE",),
        }
    }
```

정확히 2개. 더 필요하면 체이닝. v3에서 deprecated.

### 방식 B: 동적 슬롯 (ContainsAnyDict + JS)

백엔드에서 `optional`에 모든 키를 허용하고, 프론트엔드 JS가 `input_1`, `input_2`, ... 슬롯을 동적 추가.

```python
class MyDynamicNode:
    INPUT_TYPES = {
        "required": {"input_1": ("*",)},
        "optional": ContainsAnyDict()
    }
    def execute(self, **kwargs):
        inputs = []
        i = 1
        while f"input_{i}" in kwargs:
            inputs.append(kwargs[f"input_{i}"])
            i += 1
```

Prompt JSON: `"input_1": ["5", 0], "input_2": ["7", 0], "input_3": ["9", 0]`

### 방식 C: v3 Autogrow (현재 권장)

v3 스키마의 공식 가변 input 지원:

```python
autogrow_template = io.Autogrow.TemplatePrefix(
    input=io.Image.Input("image"),
    prefix="image",
    min=2,
    max=50,
)
```

`image0`, `image1`, `image2`, ... 자동 확장. 각각 1개 링크.

### 방식 D: INPUT_IS_LIST (실행 엔진 레벨)

```python
class ImageRebatch:
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
```

실행 엔진이 input을 리스트로 래핑하여 한번에 전달. prompt JSON은 동일.

---

## 3. 비교 요약

| 방식 | Input 카디널리티 | Prompt JSON | 시기 |
|------|-----------------|------------|------|
| 고정 Input (ImageBatch) | 정확히 N개 | `image1`, `image2` 각각 1링크 | deprecated |
| ContainsAnyDict + JS | 가변 (1..N) | `input_1`, `input_2`, ... | 레거시 v1 |
| v3 Autogrow | 가변 (min..max) | `image0`, `image1`, ... | 현재 권장 |
| INPUT_IS_LIST | 엔진 레벨 배칭 | 동일 JSON; 엔진이 리스트 래핑 | 집계 노드용 |

---

## 4. 우리 시스템과의 호환성

### 우리의 isList 포트

우리 시스템에서 `isList: true` 포트는 `images[0]`, `images[1]`, `images[2]` 같은 인덱싱된 핸들을 사용한다.

### ComfyUI와의 비교

| 우리 시스템 | ComfyUI |
|-----------|---------|
| `images[0]`, `images[1]` | `image0`, `image1` 또는 `input_1`, `input_2` |
| 하나의 포트 아래 인덱싱 | 별도의 고유 input key |
| DAG edge에서 `images[0]` → link | prompt에서 `image0` → link |

**결론:** 구조적으로 동일하다. 각 슬롯이 고유한 key를 가지고 1개 링크만 받는 패턴.

### Prompt 변환 시

`definition-to-prompt-translator`가 `images[0]` → `images[0]`으로 prompt key에 넣으면 ComfyUI의 `ContainsAnyDict` 또는 `Autogrow` 패턴과 호환된다.

---

## 5. DAG JSON 리팩토링에 대한 시사점

- input/output port 정의는 runtime의 `/object_info`가 SSOT
- DAG JSON에 port 정의를 저장할 필요 없음
- list port의 슬롯 확장은 UI가 `objectInfo`를 참조하여 동적 처리
- prompt 변환 시 edge binding의 key를 그대로 사용하면 ComfyUI 호환

---

## 참고 자료

- [ComfyUI Hidden and Flexible Inputs](https://docs.comfy.org/custom-nodes/backend/more_on_inputs)
- [ComfyUI Node Expansion](https://docs.comfy.org/custom-nodes/backend/expansion)
- [ComfyUI Data Lists](https://docs.comfy.org/custom-nodes/backend/lists)
- [ComfyUI v3 Migration](https://docs.comfy.org/custom-nodes/v3_migration)
- [ComfyUI Dynamic Inputs Discussion](https://github.com/comfyanonymous/ComfyUI/discussions/10324)
