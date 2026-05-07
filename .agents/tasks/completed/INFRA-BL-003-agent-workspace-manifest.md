---
title: Agent 워크스페이스 Manifest
status: completed
created: 2026-04-19
updated: 2026-05-05
priority: low
urgency: later
depends_on: INFRA-BL-002
---

## What

에이전트 실행 환경(파일, Git 저장소, 스토리지 마운트, 권한)을 선언적 Manifest로 정의한다.

어디서 실행되든(로컬, E2B, Fly.io) 동일한 워크스페이스를 재현할 수 있게 한다.

## 핵심 개념 (OpenAI SDK 참고)

Manifest는 **"fresh-session contract"** — 에이전트가 시작될 때 워크스페이스를 어떻게 구성할지를 선언하는 계약이다.

- Entry 경로는 워크스페이스 상대경로 (`..`로 탈출 불가)
- 클라우드 스토리지 마운트는 ephemeral — 스냅샷/영구화에서 제외됨
- "입력만 마운트하고, 에이전트가 읽고 쓸 위치를 명확히 지정"

## Entry 타입

| 타입             | 역할                                    |
| ---------------- | --------------------------------------- |
| `file`           | 인라인 텍스트/바이너리 파일             |
| `dir`            | 빈 디렉토리 (출력 경로 확보)            |
| `localFile`      | 호스트 파일을 샌드박스로 복사           |
| `localDir`       | 호스트 디렉토리를 샌드박스로 복사       |
| `gitRepo`        | Git 저장소 클론                         |
| `s3Mount`        | S3 버킷 마운트 (ephemeral)              |
| `gcsMount`       | Google Cloud Storage 마운트 (ephemeral) |
| `r2Mount`        | Cloudflare R2 마운트 (ephemeral)        |
| `azureBlobMount` | Azure Blob Storage 마운트 (ephemeral)   |

## TypeScript 인터페이스 설계

```typescript
type TManifestEntry =
  | { type: 'file'; content: string }
  | { type: 'dir' }
  | { type: 'localFile'; src: string }
  | { type: 'localDir'; src: string }
  | { type: 'gitRepo'; url: string; ref?: string; shallow?: boolean }
  | { type: 's3Mount'; bucket: string; prefix?: string; region: string }
  | { type: 'gcsMount'; bucket: string; prefix?: string }
  | { type: 'r2Mount'; bucket: string; accountId: string }
  | { type: 'azureBlobMount'; container: string; account: string };

interface IWorkspaceManifest {
  entries: Record<string, TManifestEntry>; // key = workspace-relative path
  environment?: Record<string, string>; // 환경변수 주입
  permissions?: {
    read: string[]; // read-only 경로 패턴
    write: string[]; // write 허용 경로 패턴
  };
}
```

## YAML 포맷 예시 (CLI용)

```yaml
# workspace.manifest.yaml
entries:
  task.md:
    type: localFile
    src: ./task.md
  repo:
    type: gitRepo
    url: https://github.com/user/project
    ref: main
    shallow: true
  output:
    type: dir
  data:
    type: s3Mount
    bucket: my-data
    region: us-east-1

permissions:
  read: [repo, task.md, data]
  write: [output]

environment:
  NODE_ENV: production
```

## SDK 통합 방식

```typescript
import type { IWorkspaceManifest } from '@robota-sdk/agent-tools';

const workspaceManifest: IWorkspaceManifest = {
  entries: {
    'task.md': { type: 'localFile', src: './task.md' },
    repo: { type: 'gitRepo', url: 'https://github.com/user/project' },
    output: { type: 'dir' },
  },
  permissions: {
    read: ['task.md', 'repo'],
    write: ['output'],
  },
};

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sandboxClient,
  workspaceManifest,
});
```

## CLI 통합 방식

```bash
robota -p "$(cat task.md)" --manifest workspace.manifest.yaml
```

## 구현 순서

1. `IWorkspaceManifest` 인터페이스 정의 (`agent-tools`)
2. `agent-tools` generic `applyWorkspaceManifest()` 구현
3. `InteractiveSession` async 초기화 경로에서 `workspaceManifest` 적용
4. YAML 파싱 → `IWorkspaceManifest` 변환 (agent-cli 후속 범위)
5. 클라우드 스토리지 마운트는 각 provider SDK 연동

## 결정 사항

**포맷: YAML (CLI) + TypeScript 객체 (SDK 직접 사용)**

- CLI에서 `--manifest` 플래그로 YAML 파일 지정
- SDK에서는 TypeScript 객체를 직접 전달 (파싱 불필요)
- 두 경로 모두 동일한 `IWorkspaceManifest` 타입으로 수렴

**Git 클론: shallow 기본값**

- `shallow: true` 기본값으로 빠른 클론
- `ref` 미지정 시 기본 브랜치 HEAD

**클라우드 마운트: ephemeral**

- 스냅샷/하이드레이션 대상에서 제외 (INFRA-BL-004와 정합)
- 마운트 credentials는 `environment`로 주입

## 연관 작업

- **INFRA-BL-002** (선행조건) — `ISandboxClient.applyManifest()` 인터페이스 필요
- **INFRA-BL-004** (스냅샷) — manifest entries 중 localFile/localDir/gitRepo만 스냅샷 대상
- **SDK-BL-004** (Ralph Loop) — 매 반복 시작 시 Manifest로 동일한 환경 재현

## Open Design Questions

1. `gitRepo` entry의 인증 — SSH key vs GitHub token 주입 방법
2. provider-specific cloud mount를 어떤 adapter capability로 노출할지

## Test Plan

- Add parser and schema tests for each manifest entry type, including path traversal rejection for `..` segments.
- Add adapter tests that verify manifest application order for files, directories, Git repositories, and ephemeral cloud mounts.
- Run package-level build, targeted manifest tests, dependency-direction scan, and `pnpm harness:scan` before implementation promotion.

## Promotion Path

1. INFRA-BL-002 완료 후 진행
2. Branch: `feat/agent-workspace-manifest` (구현 시점에 생성)

## Progress

- [x] INFRA-BL-002 sandbox execution ports 완료 확인
- [x] Branch: `feat/agent-workspace-manifest`
- [x] Manifest 계약 owner와 적용 책임을 스펙에 반영
- [x] Manifest 타입/검증/적용 테스트 추가
- [x] `agent-tools` sandbox manifest 구현
- [x] `agent-sdk` 세션 조립 경로 연결
- [x] SPEC/README/content/changeset 업데이트
- [x] 최종 검증, PR 생성, 머지 후 completed로 이동

## Decisions

- `IWorkspaceManifest`와 manifest validation/application 로직은 `agent-tools`가 소유한다. 실제 파일/명령/Git 실행-plane 포트가 `agent-tools/sandbox`에 있으므로 SDK나 CLI가 manifest 적용 알고리즘을 직접 구현하지 않는다.
- `agent-sdk`는 `sandboxClient`와 `workspaceManifest`를 받아 세션 생성 시 한 번 적용하는 조립 계층으로 유지한다.
- YAML 파싱은 이번 범위에서 CLI 전용 기능으로 분리한다. 현재 백로그는 TypeScript object contract와 sandbox 적용 포트를 먼저 완성한다.
- Cloud storage mount 타입은 계약에는 포함하되, provider-specific mounting 구현은 adapter capability가 준비될 때까지 `unsupported` 결과로 명확히 반환한다.

## Result

`agent-tools`가 `IWorkspaceManifest`, path validation, generic sandbox manifest application을 소유하도록 구현했다. `agent-sdk`는 `InteractiveSession` 초기화 시 `sandboxClient`와 `workspaceManifest`가 함께 제공된 경우 세션 생성 전에 manifest를 한 번 적용한다. CLI/YAML parsing은 별도 후속 범위로 남기고, 이번 작업은 TypeScript object contract와 sandbox application port를 완료했다.

## References

- [OpenAI Sandbox Agents — Manifest API](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [GitAgent Specification](https://github.com/open-gitagent/gitagent/blob/main/spec/SPECIFICATION.md)
- [OpenAI Agents SDK sandbox architecture — Help Net Security](https://www.helpnetsecurity.com/2026/04/16/openai-agents-sdk-harness-and-sandbox-update/)
