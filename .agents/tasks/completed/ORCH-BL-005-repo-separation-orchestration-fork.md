---
title: 오케스트레이션 중심 레포 분리 (포크)
status: blocked
created: 2026-03-15
priority: medium
urgency: later
blocked-by: physical GitHub repository creation approval
---

## 구상

현재 robota 모노레포에서 dag 관련 비중이 너무 커지고 있음. 오케스트레이션 레벨 이상의 것들만 별도 레포로 분리하여 개발.

## Current Status

### 2026-05-05 소스 확인

- `apps/web`은 현재 repo에 없고 DAG frontend shell은 `apps/dag-studio`이다.
- 실제 orchestration product surface는 `dag-studio`, `dag-designer`, `dag-cli`, `dag-mcp-server`, `dag-orchestrator-server`, `dag-orchestration-client`까지 포함해야 한다.
- `dag-api`는 아직 순수 orchestration API package가 아니다. 현재 `@robota-sdk/dag-runtime`, `@robota-sdk/dag-worker`, `@robota-sdk/dag-projection`을 직접 import하므로, 그대로 새 레포로 옮기면 runtime 레벨을 다시 끌고 간다.
- 따라서 물리적 fork 전에 extraction manifest와 dependency guard를 먼저 만들어야 한다. 목표는 가져갈 패키지의 `@robota-sdk/*` 의존 closure가 runtime 레벨로 새지 않는 상태다.

### 2026-05-05 guardrail

- `scripts/harness/check-orchestration-split-baseline.mjs`를 추가해 fork 대상 패키지와 현재 알려진 `dag-api` runtime blocker를 코드로 고정했다.
- `pnpm harness:scan:orchestration-split`를 `pnpm harness:scan`에 포함했다.
- 이 guard는 새 runtime-level 의존이 추가되면 실패하고, 기존 blocker가 해결되면 baseline/task 갱신을 요구한다.

### 2026-05-05 boundary refactor

- `dag-api`의 production dependency를 `dag-core`로 축소했다.
- `dag-api` 컨트롤러는 이제 `IRuntimeRunStarterPort`, `IRuntimeRunReaderPort`, `IRuntimeRunCancellerPort`, `IObservabilityProjectionReaderPort`, `IDiagnosticsDeadLetterReinjectPort`를 통해 외부 서비스를 주입받는다.
- `createDagExecutionComposition`은 `dag-api`에서 제거하고 `dag-runtime-server`의 app-level composition root로 이동했다.
- `dag-orchestrator-server`는 전체 `createDagControllerComposition` 대신 필요한 `DagDesignController`만 직접 조립한다.
- `scripts/harness/check-orchestration-split-baseline.mjs`의 expected blocker는 0개로 갱신했다.
- 검증은 `pnpm harness:scan`과 `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`로 통과했다.
- 남은 blocker는 코드 경계가 아니라 실제 별도 repo 대상, 이름, import/fork 전략 결정이다.

### 2026-05-07 recheck

- `scripts/harness/check-orchestration-split-baseline.mjs`는 현재 runtime-level target blocker 0개로 통과한다.
- 코드 경계만 기준으로 보면 split 대상 패키지의 production dependency closure는 현재 fork 가능한 상태다.
- `woojubb` 계정에는 `robota` 원본 repo가 있지만, 이 task의 대상이 될 별도 orchestration repo 이름과 공개 범위는 아직 확정되어 있지 않다.
- 결론: repo 내부 구현 작업은 더 진행할 수 있는 blocker가 없다. 남은 작업은 외부 GitHub repo 생성/권한/가시성 결정이며, 이를 agent가 임의로 실행하면 되돌리기 어려운 운영 변경이 된다.

## Recommendation

현재 repo 안의 경계 검증은 완료된 상태로 유지한다. 별도 repo 생성은 다음 추천안을 기본값으로 삼되, 실제 생성은 owner 승인 후 진행한다.

1. 추천 repo 이름은 `robota-orchestration`이다. 초기에는 private으로 만들고, 배포/문서/패키지 공개 범위가 확정되면 public 전환을 별도 결정한다.
2. 초기 import 전략은 one-time history-preserving split이다. `git filter-repo` 또는 equivalent mirror workflow로 아래 target package/app path만 가져간다.
3. package name은 첫 split에서는 `@robota-sdk/*`를 유지한다. 새 registry/package scope 전환은 공개 API와 npm publish 정책이 걸린 별도 작업으로 분리한다.
4. 새 repo CI에서 `pnpm build`, `pnpm harness:scan:orchestration-split`, `dag-studio`, `dag-designer`, `dag-orchestrator-server`, `dag-cli`, `dag-mcp-server` 검증을 구성한다.
5. 원본 repo에는 split 이후 유지할 sync 정책을 별도 ADR로 남긴다.

## Owner Decision Required

- [ ] GitHub repo 이름과 visibility 승인: recommended `woojubb/robota-orchestration`, private first
- [ ] history-preserving split 방식 승인: recommended one-time `git filter-repo` import
- [ ] split 직후 package scope 유지 승인: recommended keep `@robota-sdk/*` until publish strategy changes

## 가져갈 것 (오케스트레이션 이상)

- `packages/dag-orchestrator` — 오케스트레이션 코어
- `packages/dag-cost` — 비용 추정 (CEL)
- `packages/dag-core` — 도메인 타입 (공유 기반)
- `packages/dag-designer` — DAG 디자이너 UI
- `packages/dag-adapters-local` — 로컬 어댑터
- `packages/dag-orchestration-client` — thin operational REST client
- `packages/dag-cli` — JSON-first operational CLI
- `packages/dag-mcp-server` — MCP operational surface
- `apps/dag-orchestrator-server` — 오케스트레이션 서버
- `apps/dag-studio` — DAG Designer frontend shell

## 조건부로 가져갈 것

- `packages/dag-api` — runtime/projection/worker composition을 분리한 뒤 가져간다.
- `packages/auth`, `packages/credits` — orchestration server의 인증/크레딧 기능이 실제 production scope에 들어가는 시점에 가져간다.

## 가져가지 않을 것

- `packages/agents` — Robota Agent SDK (원본 레포에 유지)
- `apps/dag-runtime-server` — ComfyUI로 대체 예정
- `packages/dag-worker` — runtime 레벨 (ComfyUI가 대체)
- `packages/dag-runtime` — runtime 레벨
- `packages/dag-scheduler` — runtime 레벨
- `packages/dag-projection` — runtime 레벨
- `packages/dag-api` runtime/projection/worker composition — 분리 전에는 가져가지 않음
- `packages/dag-node` — 노드 정의 프레임워크 (runtime 레벨)
- `packages/dag-nodes/*` — 개별 노드 구현 (runtime 레벨)

## 분리 후 구조 (새 레포)

```
orchestration-repo/
├── packages/
│   ├── dag-core/           # 공유 타입
│   ├── dag-orchestrator/   # 오케스트레이션 코어
│   ├── dag-cost/           # 비용 추정
│   ├── dag-designer/       # DAG 디자이너 UI
│   ├── dag-adapters-local/ # 로컬 어댑터
│   ├── dag-orchestration-client/
│   ├── dag-cli/
│   └── dag-mcp-server/
├── apps/
│   ├── orchestrator-server/ # 오케스트레이션 서버
│   └── dag-studio/          # DAG Designer frontend shell
└── (향후)
    ├── packages/auth/       # 인증
    ├── packages/credits/    # 크레딧
    └── packages/dag-api/    # runtime composition 분리 후 API contracts/controllers
```

## 의존 방향

```
새 레포 (오케스트레이션)
    ↓ HTTP API
ComfyUI (외부, Docker)
```

오케스트레이션은 ComfyUI API만 바라봄. runtime 코드 의존 없음.

## 장점

- 오케스트레이션에 집중
- runtime 코드 없이 ComfyUI를 순수 백엔드로 사용
- 인증/크레딧/CLI/MCP 등 오케스트레이션 상위 기능 자유롭게 개발
- agent SDK와 독립적으로 발전 가능

## 검증

- fork manifest 대상 패키지의 `@robota-sdk/*` dependency closure가 runtime/projection/worker/node 구현 패키지로 새지 않는지 확인
- `pnpm build` 또는 fork 대상 scoped build 성공 확인
- `dag-studio`, `dag-designer`, `dag-orchestrator-server`, `dag-cli`, `dag-mcp-server` typecheck/lint/test 통과 확인
