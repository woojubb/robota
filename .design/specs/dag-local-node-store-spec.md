# DAG Local Node Store 규격 (v1)

## 목적

- v1에서는 Marketplace 연동 없이 로컬 폴더의 노드 패키지만 로드/사용한다.
- 노드 목록 갱신은 자동 반영하지 않고, 명시적 reload API 호출로만 수행한다.

## 경로 규칙

- Node Store 루트 경로:
  1. `ROBOTA_NODE_STORE_DIR` 환경변수
  2. 미설정 시 `./.robota/nodes/`

- 디렉토리 구조:
  - `<storeRoot>/<publisher>/<nodeType>/<version>/`

## 패키지 파일 규격

각 버전 폴더는 아래 파일을 포함해야 한다.

- `manifest.json` (필수)
- `dist/handler.js` 또는 동등 entry 파일 (v1에서는 로더 확장 포인트로 예약)
- `README.md` (선택)

`manifest.json` 필수 최소 필드:

- `nodeType: string`
- `displayName: string`
- `category: string`
- `inputs: IPortDefinition[]`
- `outputs: IPortDefinition[]`

## SSOT 설계

### SSOT-1: 노드 계약 SSOT

- 위치: 각 노드의 `manifest.json`
- 포함: 입출력 포트/노드 계약/기술 메타정보

### SSOT-2: 운영 노출 SSOT

- 위치: `<storeRoot>/collection.json`
- 포함: 노출/비노출/활성화/카테고리 오버라이드

중복 금지 원칙:

- 운영 제어 필드(enable/disable/hidden)는 `manifest.json`에 두지 않는다.
- 계약 필드는 `collection.json`에 두지 않는다.

## collection.json 규격 (v1)

```json
{
  "nodes": {
    "image-source": {
      "enabled": true,
      "hidden": false,
      "category": "My Local Nodes"
    },
    "ok-emitter": {
      "enabled": false
    }
  }
}
```

## Reload 동작 규칙

- `POST /v1/dag/nodes/reload` 호출 시에만 폴더 재스캔
- reload는 아래 순서만 수행:
  1. Node Store 폴더 스캔
  2. manifest 파싱/검증
  3. collection metadata 적용
  4. 최종 인덱스 스냅샷 교체

금지:

- 파일 변경 자동 감지 후 자동 갱신
- reload 실패 시 조용한 무시

## API 계약 (v1)

- `GET /v1/dag/nodes`
  - 현재 인덱스 기준 노드 목록 반환
- `POST /v1/dag/nodes/reload`
  - 재스캔 수행 후 `loadedCount` 반환

## no-fallback 정책

- manifest 누락/파싱 실패/스키마 위반은 즉시 실패
- nodeType 미등록 상태에서 validate/publish는 즉시 실패
- 자동 대체 핸들러/자동 복구/자동 매핑 금지
