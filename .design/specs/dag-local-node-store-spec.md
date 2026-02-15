# DAG Node Delivery 규격 (Bundle-first)

## 상태

- 이 문서는 기존 로컬 폴더 스캔 모델을 대체한다.
- `ROBOTA_NODE_STORE_DIR`, 폴더 스캔, `POST /v1/dag/nodes/reload`는 사용하지 않는다.

## 목적

- Lambda/Container 배포에서 노드 집합의 재현성과 안정성을 확보한다.
- 런타임 파일시스템 의존 없이 빌드된 아티팩트만으로 노드를 로드한다.

## 기본 원칙

- 노드 카탈로그는 번들된 manifest 집합으로만 구성한다.
- 런타임 동적 설치/동적 스캔/자동 리로드를 금지한다.
- 서버 초기화 시 노드 목록과 라이프사이클 팩토리를 명시적 파라미터로 주입한다.
- DAG 노드는 모노레포 `packages/dag-nodes/<slug>` 패키지 단위로 관리한다.
- DAG 노드 패키지명은 `@robota-sdk/dag-node-<slug>` 규칙을 사용한다.
- 노드 설정 스키마 SSOT는 내부 `configSchemaDefinition`으로 관리한다.
- 외부(API/디자이너) 노출 형식은 JSON Schema object(`configSchema`)로 통일한다.
- JSON Schema는 수동 작성하지 않고 Zod에서 자동 생성한다.

## 서버 초기화 계약

권장 부트스트랩 형태:

```ts
createDagServer({
  nodeManifests,
  nodeCatalogService,
  nodeLifecycleFactory
});
```

필수 규칙:

- `nodeManifests`는 빌드 시점에 확정된 값이어야 한다.
- `nodeCatalogService`는 in-memory/static registry 기반이어야 한다.
- 엔트리포인트를 환경별로 분기하지 않는다. 단일 서버 부트스트랩 계약을 사용하고 주입 값/인프라 설정만 달라야 한다.
- `apps/api-server`에서 `@robota-sdk/dag-node-*`의 `IDagNodeDefinition` 클래스 인스턴스를 직접 import하고, 중앙 assembly로 `nodeManifests`/`nodeLifecycleFactory`를 조합한다.

## API 계약

- `GET /v1/dag/nodes`
  - 현재 번들된 노드 목록 반환
- `POST /v1/dag/nodes/reload`
  - 엔드포인트 자체를 제공하지 않는다 (삭제)

## 배포 모델

- Dev: `packages/dag-nodes/*` 빌드 결과를 사용
- Prod(Container): 이미지 빌드 시 `@robota-sdk/dag-node-*` 패키지 포함
- Lambda: 별도 DAG 엔트리 추가 없이 동일 부트스트랩을 사용하고 배포 어댑터에서 동일 프로세스를 감싼다

## no-fallback 정책

- 미등록 nodeType은 validate/publish에서 즉시 실패
- 런타임 재스캔으로 문제를 우회하지 않는다
- 배포 단위는 항상 재빌드/재배포로 처리한다
