---
title: Agent 워크스페이스 Manifest
status: backlog
created: 2026-04-19
updated: 2026-04-19
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
// createSession()에 manifest 옵션 추가
const session = new InteractiveSession({
  manifest: {
    entries: {
      'task.md': { type: 'localFile', src: './task.md' },
      repo: { type: 'gitRepo', url: 'https://github.com/user/project' },
      output: { type: 'dir' },
    },
    permissions: {
      read: ['task.md', 'repo'],
      write: ['output'],
    },
  },
});
```

## CLI 통합 방식

```bash
robota -p "$(cat task.md)" --manifest workspace.manifest.yaml
```

## 구현 순서

1. `IWorkspaceManifest` 인터페이스 정의 (agent-sdk)
2. YAML 파싱 → `IWorkspaceManifest` 변환 (agent-cli)
3. `ISandboxClient.applyManifest(manifest)` 메서드 추가 (INFRA-BL-002 인터페이스 확장)
4. `E2BSandboxClient`에서 manifest entry별 파일/디렉토리/Git 클론 실행
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

1. `manifest` 옵션을 `createSession()`에 직접 추가할지, `SandboxOptions` 하위에 넣을지
2. `gitRepo` entry의 인증 — SSH key vs GitHub token 주입 방법

## Promotion Path

1. INFRA-BL-002 완료 후 진행
2. Branch: `feat/agent-workspace-manifest` (구현 시점에 생성)

## References

- [OpenAI Sandbox Agents — Manifest API](https://developers.openai.com/api/docs/guides/agents/sandboxes)
- [GitAgent Specification](https://github.com/open-gitagent/gitagent/blob/main/spec/SPECIFICATION.md)
- [OpenAI Agents SDK sandbox architecture — Help Net Security](https://www.helpnetsecurity.com/2026/04/16/openai-agents-sdk-harness-and-sandbox-update/)
