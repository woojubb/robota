---
title: 'DOCS-020: 문서/SPEC 정합 배치: 자기모순·오귀속·미수출 API 안내 일소'
status: done
completed: 2026-07-24
created: 2026-07-04
priority: medium
urgency: soon
area: packages, content
depends_on: ['HARNESS-022', 'ARCH-004']
---

# 문서/SPEC 정합 배치: 자기모순·오귀속·미수출 API 안내 일소

Re-audit P2-13 (DOCS-1~7 + CONTRACT-008/009/010/017/018/019/020; CONTRACT-020⊂DOCS-2/4). 전부
prose 레벨(스캔 커버 ts 블록 깨진 import 0 실측). framework SPEC 자기모순, 오귀속
(ITransportAdapter 등), 미수출 createSession()·부재 SessionManager 안내, transport README 허위
재수출 주장, agent-cli SPEC 의존 표 절반 누락, interface-transport SPEC 부재 export 4종.

## What

1. 발견 전건 수정(SPEC 6+, README 4+, content/guide 2+, migration.md).
2. 선행 제공 표면 문서는 ARCH-004 하드닝 결과 기준 정확화.
3. 구식 API 전체 grep 재실행 0건 확인.

## Test Plan

- harness:scan(doc-examples/specs/docs-structure) green; 오귀속 심볼 전수 grep 0.

## User Execution Test Scenarios

Not applicable — prose 전용 문서 정합. 대체 검증: 스캔 green + 구식 API grep 0건.

## Outcome (2026-07-24)

ARCH-004/HARNESS-022 이후 재검증 기준으로 잔존 부정합 전건 수정 (audit-era 발견 다수는 이미 해소 확인):

- `content/guide/migration.md` — "프로바이더 단일 패키지 통합(`@robota-sdk/agent-provider`)" 서사가
  실재(독립 패키지 유지, google→gemini 개명 + deepseek→openai-compatible 흡수)와 자기모순 →
  요약표·개명 목록(중복 3행 포함)·package.json diff·업그레이드 1·2단계 전부 실제 패키지명으로 교정.
- `content/guide/providers.md` — 부재 패키지 `@robota-sdk/agent-provider` install 명령 6건 →
  실제 표준 패키지(`-anthropic`/`-openai`/`-gemini`/`-openai-compatible`)로 교정 (import 블록은 이미 정상).
- `content/guide/embedding.md` — 미수출 `createSession` 단독 표기 5건 → 공개 표면인
  `runtime.createSession()` 표기로 정정.
- `packages/agent-cli/docs/SPEC.md` — Dependencies 표 절반 누락 해소: 오귀속 provider 행
  (`agent-provider-openai` 서브패스 서사 → `agent-provider-defaults`의
  `createDefaultProviderDefinitions`) 교정 + 실소비 워크스페이스 의존 12행 추가(실측: prod import 17
  지정자) + `qrcode` 직수입 행 + 번들 승격(호이스팅) 서드파티 주석; `agent-sessions`/`agent-sdk`
  유령 패키지명 7건 → 실명(`agent-session`/`agent-framework`) 교정; §45 "CLI re-exports
  ITerminalOutput/ISpinner" ↔ §943 "no longer re-exported" 자기모순 → 실측(index.ts 미수출)대로 통일.
- `packages/agent-framework/docs/SPEC.md` — sessionRequirements 값 `'agent-executor'` 오기 →
  코드 실측 `'agent-runtime'`(`TCommandModuleSessionRequirement`); Unconnected Packages 표에서
  부재 패키지(agent-team, agent-event-service, agent-plugin-\*, 단일 agent-provider 서사) 제거;
  Extension Points의 미수출 `createSession()` 안내 → 내부 전용 명시 + 공개 표면
  (`InteractiveSession` options / `createAgentRuntime`) 예시로 교체.
- `packages/agent-transport/docs/SPEC.md` — 부재 export `IProgrammaticAgent` 2건 → 실제 반환 타입
  `IAgentDriver`(agent-interface-transport 소유, 재수출 없음) 안내로 교정.
- `packages/agent-interface-transport/README.md` — "타입 전용, 런타임 코드 0" 허위(순수 접근자
  4종 + 상수 2종 실재) 교정 + `ITransportAdapter`/`IConfigurableTransport` 시그니처 드리프트
  (start/stop Promise·stop 필수·optionsSchema 옵셔널 구조체) 실코드 정합.
- `packages/agent-tool-mcp/docs/SPEC.md`, `packages/agent-playground/docs/SPEC.md` — 유령 패키지명
  (`agent-sdk`/`agent-sessions`) 실명 교정.
- 이미 해소 확인(수정 불요): transport README 재수출 주장(정확), interface-transport SPEC export
  표(부재 export 0), SessionManager 안내 0건, agent-session README의 createSession 내부 명시.

검증: `node scripts/harness/run-all-scans.mjs` 59/59 green (doc-examples/specs/spec-paths/
spec-public-surface/ghost-package-refs/docs-structure 포함); 오귀속·구식 심볼 전수 grep 0건
(`@robota-sdk/agent-provider` 단독 0, SessionManager 0, agent-sdk/agent-sessions/agent-team 0,
`IProgrammaticAgent` 0, content 단독 `createSession` 0).
