---
title: Agent 워크스페이스 스냅샷/하이드레이션
status: backlog
created: 2026-04-19
updated: 2026-04-19
priority: low
urgency: later
depends_on: INFRA-BL-002, INFRA-BL-003
---

## What

에이전트 실행 중 워크스페이스 전체 상태를 스냅샷으로 저장하고, 중단된 실행을 스냅샷에서 그대로 복원(하이드레이션)해 재개한다.

현재 Robota의 `--resume`(세션 히스토리 재개)과는 다른 개념:

- 기존 `--resume`: 대화 컨텍스트(메시지 히스토리) 복구
- 이 기능: 실행 환경(파일시스템, 프로세스, 메모리 상태) 복구

## 구현 접근법 (2가지)

### 접근법 A — Provider-level snapshot (추천)

샌드박스 provider(E2B, Fly.io Sprites)가 스냅샷을 직접 처리. Robota는 **스냅샷 ID만 저장/복원**.

```
실행 종료 시:
  ISandboxClient.snapshot() → snapshotId 반환
  SessionStore에 { sessionId, snapshotId } 저장

재개 시:
  SessionStore에서 snapshotId 조회
  ISandboxClient.restore(snapshotId) → 환경 복원
  기존 --resume으로 대화 히스토리 복원
```

### 접근법 B — Temporal Durable Execution (복잡, 나중에 검토)

Temporal Workflow로 에이전트 실행 전체를 래핑 — 각 LLM 호출/툴 실행이 Activity가 되어 자동 재시도/크래시 복구.

- 장점: 네트워크 오류, 크래시, rate limit 등 모든 실패에서 자동 복구
- 단점: Temporal 서버 인프라 필요, 상당한 아키텍처 변경
- 현재 Robota 범위 초과 → 나중에 별도 백로그로 검토

**결론: 접근법 A부터 구현**

## Provider별 스냅샷 API

### E2B

```typescript
// 일시정지 (메모리 + 파일시스템 전체 보존)
const sandboxId = sandbox.sandboxId;
await sandbox.pause(); // RAM 1GB당 ~4초 소요

// 재개 (~1초)
const resumed = await Sandbox.connect(sandboxId, {
  timeoutMs: 60 * 1000,
});

// 자동 일시정지 설정
const sandbox = await Sandbox.create({
  lifecycle: { onTimeout: 'pause' },
});
```

- **보존 대상**: 파일시스템 + 메모리 (실행 중 프로세스, 변수 포함)
- **저장 기간**: 무기한 (일시정지 상태)
- **주의**: 다중 재개 시 파일 변경이 누락되는 버그 존재 (E2B issue #884)

### Fly.io Sprites

- **구현**: JuiceFS 기반 — data(S3 호환 객체 스토리지) + metadata(로컬 NVMe + Litestream)
- **체크포인트**: metadata 재배열만 수행 → **~300ms**
- **핵심 원리**: "Sprite의 내구적 상태는 단순히 URL" — 불변 청크, NVMe는 캐시
- **철학**: escape hatch가 아닌 기본 기능 (git restore처럼 자연스럽게)
- **장점**: 매우 빠름, 100GB NVMe 영구 스토리지
- **TypeScript SDK**: 없음, HTTP API 직접 호출 필요

## ISandboxClient 인터페이스 확장

```typescript
interface ISandboxClient {
  // ... 기존 메서드 (INFRA-BL-002)

  // 스냅샷
  snapshot(): Promise<string>; // snapshotId 반환
  restore(snapshotId: string): Promise<void>;

  // 자동 일시정지 설정 (create 시)
  // onTimeout: 'pause' | 'kill'
}
```

## SessionStore 연동

기존 SessionStore에 `snapshotId` 필드 추가:

```typescript
interface ISessionMetadata {
  sessionId: string;
  snapshotId?: string; // sandbox snapshot ID
  // ... 기존 필드
}
```

`--resume <sessionId>` 시:

1. SessionStore에서 `snapshotId` 조회
2. `snapshotId` 있으면 `ISandboxClient.restore(snapshotId)` 호출
3. 대화 히스토리도 함께 복원

## CLI 통합

```bash
# 실행 종료 후 snapshotId가 sessionStore에 자동 저장됨
robota -p "$(cat task.md)" --session my-session

# 재개 시 (대화 히스토리 + 워크스페이스 상태 모두 복원)
robota --resume my-session
```

별도 `--resume-snapshot` 플래그 없이 기존 `--resume`을 확장하는 방향.

## 구현 순서

1. `ISandboxClient`에 `snapshot()` / `restore()` 추가 (INFRA-BL-002 확장)
2. `E2BSandboxClient`에서 `pause()` / `connect()` 구현
3. `SessionStore`에 `snapshotId` 필드 추가
4. `--resume` 처리 시 `snapshotId` 있으면 sandbox restore 선행
5. Fly.io Sprites HTTP API 클라이언트 추가 (선택)

## 연관 작업

- **INFRA-BL-002** (선행조건) — `ISandboxClient` 인터페이스 기반
- **INFRA-BL-003** (선행조건) — Manifest entry 중 localFile/localDir/gitRepo만 스냅샷 대상, 클라우드 마운트는 ephemeral
- **SDK-BL-004** (Ralph Loop) — 실패한 반복을 snapshot에서 재시도 가능

## Open Design Questions

1. E2B 다중 재개 버그(issue #884) 해결 전까지 Fly.io Sprites 우선 검토할지
2. snapshotId를 SessionStore에 저장할지, 별도 SnapshotStore로 분리할지
3. Temporal 통합은 별도 INFRA-BL-005로 분리할지

## Promotion Path

1. INFRA-BL-002, INFRA-BL-003 완료 후 진행
2. E2B pause/resume부터 구현 (TS SDK 있음)
3. Branch: `feat/agent-snapshot-hydration` (구현 시점에 생성)

## References

- [E2B Sandbox Persistence](https://e2b.dev/docs/sandbox/persistence)
- [Fly.io Sprites Design & Implementation](https://fly.io/blog/design-and-implementation/)
- [Temporal + OpenAI Agents SDK Integration](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- [E2B pause bug — GitHub issue #884](https://github.com/e2b-dev/E2B/issues/884)
- [Best platforms for long-running sandbox environments — Northflank](https://northflank.com/blog/best-platforms-for-long-running-sandbox-environments)
