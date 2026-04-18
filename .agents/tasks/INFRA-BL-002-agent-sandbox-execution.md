---
title: Agent 샌드박스 실행 환경
status: backlog
created: 2026-03-15
updated: 2026-04-19
priority: medium
urgency: later
---

## What

에이전트가 BashTool, 파일 읽기/쓰기 등의 도구를 실행할 때 호스트 시스템이 아닌 격리된 환경에서 실행되도록 한다.

현재 `BashTool`은 호스트 프로세스에서 직접 실행됨 — 에이전트가 잘못된 명령을 실행하면 실제 파일시스템에 영향을 줌.

## 아키텍처 방향 (OpenAI SDK 참고)

OpenAI Agents SDK가 채택한 구조:

```
Control Plane (API keys, orchestration, permissions)
        ↕  SandboxClient interface
Execution Plane (격리된 VM — 파일/셸/패키지)
```

- Control Plane과 Execution Plane을 분리하면 악성 명령이 API 키나 중앙 제어 시스템에 접근 불가
- `SandboxClient` 추상 인터페이스로 provider를 교체 가능하게 설계
- OpenAI SDK는 E2B, Modal, Fly.io Sprites, Daytona, Blaxel, Cloudflare, Vercel 등 플러그인 방식으로 지원

Robota 설계 예시:

```typescript
interface ISandboxClient {
  run(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  snapshot(): Promise<string>; // snapshot ID
  restore(snapshotId: string): Promise<void>;
}
```

## 플랫폼별 기술 비교

### E2B — 추천 기본값

- **격리**: Firecracker microVM (전용 커널, 하이퍼바이저 레벨 격리)
- **부팅 시간**: ~150ms
- **TypeScript SDK**: `npm i e2b` — 공식 JS/TS SDK 제공

```typescript
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create();
const result = await sandbox.commands.run('echo hello');
console.log(result.stdout);
await sandbox.kill();
```

- **세션 일시중지/재개** 지원
- **GPU**: 미지원
- **가격**: 200개 기준 $16,819/월 (가장 저렴)
- **적합**: AI 에이전트 특화, TS 지원, 빠른 통합

### Fly.io Sprites — 장시간 실행 에이전트

- **격리**: Firecracker microVM
- **출시**: 2026년 1월
- **특징**: 100GB 영구 NVMe 스토리지, 체크포인트/복구 ~300ms
- **과금**: 유휴 시 과금 중단 (장시간 실행 에이전트에 유리)
- **GPU**: 미지원
- **TypeScript SDK**: 별도 SDK 없음, HTTP API 직접 호출
- **가격**: 200개 기준 $35,770/월
- **적합**: 세션 간 상태 유지가 필요한 장시간 에이전트, Ralph Loop

### Modal — GPU 워크로드

- **격리**: gVisor (사용자 공간 커널, 전용 커널 없음)
- **특징**: Python 중심, GPU(NVIDIA) 전 인프라 지원
- **TypeScript SDK**: 미제공 (Python 전용)
- **가격**: 200개 기준 $24,491/월
- **적합**: GPU 연산 필요한 ML 에이전트

### AWS Lambda — 서버리스 (비추천)

- **격리**: Firecracker microVM (Lambda 내부 기술)
- **제약**: 15분 타임아웃, 250MB 패키지 제한
- **TypeScript**: 지원
- **문제**: 에이전트 샌드박스 전용이 아님, 장시간 실행 불가

## 플랫폼 선택 가이드

| 상황                      | 추천                    |
| ------------------------- | ----------------------- |
| 기본 통합 (TS, 빠른 시작) | **E2B**                 |
| 장시간 실행, 세션 유지    | **Fly.io Sprites**      |
| GPU 필요                  | **Modal** (Python only) |
| 로컬 개발/테스트          | **Docker**              |

## SDK 패키지 호환성

| 패키지                   | 서버리스      | 비고                            |
| ------------------------ | ------------- | ------------------------------- |
| agent-core               | O             | 순수 로직                       |
| agent-sessions           | O             | `node:path` 사용                |
| agent-sdk                | O             | config 로딩에 `node:fs` 사용    |
| agent-tools              | O → 수정 필요 | BashTool을 SandboxClient로 교체 |
| agent-provider-anthropic | O             | HTTP only                       |
| agent-cli                | N/A           | 터미널 전용                     |

## 핵심 구현 범위

1. `ISandboxClient` 인터페이스 정의 (agent-tools 또는 agent-core)
2. `E2BSandboxClient` 구현체 (기본값)
3. `BashTool`이 SandboxClient를 선택적으로 사용하도록 수정
4. `createSession()` 옵션에 `sandbox?: ISandboxClient` 추가

## 연관 작업

- **SDK-BL-004** (Ralph Loop) — 매 반복마다 클린한 샌드박스에서 시작하면 시너지
- **INFRA-BL-003** (Manifest) — 샌드박스 위에서 워크스페이스 정의
- **INFRA-BL-004** (스냅샷) — Fly.io Sprites 체크포인트 기능 활용

## Open Design Questions

1. `ISandboxClient`를 어느 패키지에 둘지 (agent-core vs agent-tools)
2. 샌드박스 없이 실행할 때 fallback 전략 — LocalSandboxClient (Docker) vs 호스트 직접 실행
3. 파일시스템 권한 제어 API 설계 (read-only paths, write paths 명시)

## Promotion Path

1. Open design questions 답변 후 스펙 작성
2. E2B 통합부터 시작 (TS SDK 있음, 가장 간단)
3. Branch: `feat/agent-sandbox-execution` (구현 시점에 생성)

## References

- [E2B Docs](https://e2b.dev/docs)
- [E2B vs Modal vs Fly.io Sprites — Northflank](https://northflank.com/blog/e2b-vs-modal-vs-fly-io-sprites)
- [Top 5 Code Sandboxes for AI Agents in 2026 — DEV](https://dev.to/nebulagg/top-5-code-sandboxes-for-ai-agents-in-2026-58id)
- [OpenAI Agents SDK Sandbox — TechCrunch](https://techcrunch.com/2026/04/15/openai-updates-its-agents-sdk-to-help-enterprises-build-safer-more-capable-agents/)
- [OpenAI Agents SDK Sandbox Architecture — Help Net Security](https://www.helpnetsecurity.com/2026/04/16/openai-agents-sdk-harness-and-sandbox-update/)
