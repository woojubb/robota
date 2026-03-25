---
title: 패키지 번들링 & SPEC 계약 감사 결과
status: in-progress
priority: high
created: 2026-03-25
packages:
  - agent-core
  - agent-sessions
  - agent-sdk
  - agent-cli
  - agent-provider-anthropic
  - agent-provider-google
  - agent-tools
  - agent-event-service
---

## 작업 순서 (우선순위 높은 순)

### Phase 1 — 영향 없는 즉시 수정 (package.json / 빌드 설정)

- [x] **F-01** `"module"` 필드 제거 — core, sessions, provider-anthropic, provider-google
  - 존재하지 않는 `dist/node/index.mjs` 참조. `exports` 맵이 정상이므로 `module` 필드만 삭제
- [x] **F-02** sessions `browser` export 조건 제거
  - `dist/browser/` 미존재, tsup node-only 빌드. 죽은 export 경로
- [x] **F-03** provider-anthropic, provider-google `dist/` 루트 잔재 정리
  - 2월 구버전 빌드 파일. `pnpm clean && pnpm build`로 해결
- [x] **F-04** event-service `publishConfig` vs `private: true` 모순 해결
  - `publishConfig` 제거 (private 패키지)
- [x] **F-05** cli `bin.cjs` 데드 코드 — tsup 설정 분리로 CJS에서 bin 제외
  - bin.ts는 ESM only, index.ts만 ESM+CJS

### Phase 2 — SPEC 문서 정합성 (코드 변경 없음)

- [x] **S-01** core: EventService 4개 클래스 SPEC에서 제거 (미export이므로 SPEC이 잘못됨)
- [x] **S-02** core: `DEFAULT_MAX_OUTPUT`, `getModelMaxOutput` SPEC에 추가
- [x] **S-03** core: SPEC 제목 "Agents Specification" → "Agent Core Specification"
- [x] **S-04** sdk: 번들 타입명 수정 (`IBundleManifest`→`IBundlePluginManifest`, `IBundlePlugin`→`ILoadedBundlePlugin`, `BundleLoader`→`BundlePluginLoader`, `BundleInstaller`→`BundlePluginInstaller`)
- [x] **S-05** sdk: `AgentDefinitionLoader` export 여부 결정 및 SPEC 반영
- [x] **S-06** sdk: `webFetchTool`, `webSearchTool` re-export 누락 반영
- [x] **S-07** provider-anthropic: `api-types.ts` SPEC에서 public export 주장 제거
- [x] **S-08** provider-google: `api-types.ts` dead code SPEC 반영, 테스트 섹션 업데이트
- [x] **S-09** tools: `TToolResult.startLine` SPEC에 추가
- [x] **S-10** cli: 파일 구조 테이블에서 `visual-line.ts` 제거 + 누락 파일 추가
- [x] **S-11** sessions: `IPermissionEnforcerOptions` export 여부 결정 및 SPEC 반영
- [x] **S-12** event-service: SPEC 최소 내용 작성 (현재 거의 비어있음)

### Phase 3 — 구조적 이슈 (설계 판단 필요)

- [x] **A-01** event-service ↔ core SSOT 위반 해결
  - core가 SSOT. event-service는 core에서 re-export. 중복 소스 파일 삭제됨
- [x] **A-02** provider-google 브라우저 빌드 `node:crypto` 문제
  - `import { randomUUID } from 'node:crypto'` → `crypto.randomUUID()` (Web Crypto API) 전환

---

## 패키지별 상세 감사 결과

### agent-core (v3.0.0-beta.33)

| 카테고리  | 발견                                                 | 심각도 |
| --------- | ---------------------------------------------------- | ------ |
| 의존 방향 | 위반 없음                                            | OK     |
| SPEC      | EventService 4개 클래스 public API 주장하나 미export | High   |
| SPEC      | `DEFAULT_MAX_OUTPUT`, `getModelMaxOutput` 미문서화   | Low    |
| SPEC      | 제목 "Agents Specification" (core 아님)              | Low    |
| 번들      | `module` 필드 `.mjs` 참조 (미존재)                   | High   |
| 번들      | `builtin-templates.json` node/browser 중복           | Low    |
| 번들 크기 | ESM 127KB, CJS 128KB, DTS 148KB                      | —      |

### agent-sessions (v3.0.0-beta.33)

| 카테고리  | 발견                                                 | 심각도 |
| --------- | ---------------------------------------------------- | ------ |
| 의존 방향 | 위반 없음 (core만 의존)                              | OK     |
| SPEC      | `IPermissionEnforcerOptions` SPEC에 있지만 미export  | Minor  |
| SPEC      | `IContextWindowState` core에서 re-export (규칙 긴장) | Low    |
| 번들      | `module` 필드 `.mjs` 참조 (미존재)                   | High   |
| 번들      | `browser` export 경로 `dist/browser/` 미존재         | High   |
| 번들 크기 | ESM 25KB, CJS 25KB, DTS 15KB                         | —      |

### agent-sdk (v3.0.0-beta.33)

| 카테고리  | 발견                                                | 심각도 |
| --------- | --------------------------------------------------- | ------ |
| 의존 방향 | 위반 없음                                           | OK     |
| SPEC      | 타입명 불일치 4건 (IBundleManifest 등)              | High   |
| SPEC      | `AgentDefinitionLoader` 미export                    | Medium |
| SPEC      | `webFetchTool`, `webSearchTool` SDK에서 미re-export | Medium |
| 번들      | 정상                                                | OK     |
| 번들 크기 | ESM 65KB, CJS 72KB, DTS 33KB                        | —      |

### agent-cli (v3.0.0-beta.40)

| 카테고리  | 발견                                       | 심각도 |
| --------- | ------------------------------------------ | ------ |
| 의존 방향 | 위반 없음                                  | OK     |
| SPEC      | 파일 구조 테이블 9개 항목 drift            | Medium |
| SPEC      | `visual-line.ts` 내부 모순                 | Medium |
| SPEC      | `ITerminalOutput`/`ISpinner` 중복 (인지됨) | Low    |
| 번들      | `bin.cjs` 114KB 데드 코드                  | Medium |
| 번들 크기 | ESM 106KB (chunk), CJS 114KB               | —      |

### agent-provider-anthropic (v3.0.0-beta.33)

| 카테고리  | 발견                                           | 심각도 |
| --------- | ---------------------------------------------- | ------ |
| 의존 방향 | 위반 없음 (core만)                             | OK     |
| SPEC      | `api-types.ts` public export 주장하나 미export | Medium |
| SPEC      | `createAnthropicProvider` void 반환 (stub)     | Low    |
| 번들      | `module` 필드 `.mjs` 참조 (미존재)             | High   |
| 번들      | `dist/` 루트 잔재물                            | Medium |
| 번들 크기 | ESM 6.7KB, CJS 6.9KB, DTS 5.4KB                | —      |

### agent-provider-google (v3.0.0-beta.24)

| 카테고리  | 발견                                                     | 심각도 |
| --------- | -------------------------------------------------------- | ------ |
| 의존 방향 | 위반 없음 (core만)                                       | OK     |
| SPEC      | `api-types.ts` 28개 타입 dead code, SPEC에서 export 주장 | Medium |
| SPEC      | 테스트 섹션 outdated (1→4 파일)                          | Low    |
| 번들      | `module` 필드 `.mjs` 참조 (미존재)                       | High   |
| 번들      | `node:crypto` 브라우저 빌드 런타임 실패                  | High   |
| 번들      | `dist/` 루트 잔재물                                      | Medium |
| 번들 크기 | ESM 8.6KB, CJS 8.6KB, DTS 4.4KB                          | —      |

### agent-tools (v3.0.0-beta.33)

| 카테고리  | 발견                             | 심각도 |
| --------- | -------------------------------- | ------ |
| 의존 방향 | 위반 없음 (core만)               | OK     |
| SPEC      | `TToolResult.startLine` 미문서화 | Low    |
| 번들      | 정상                             | OK     |
| 번들 크기 | ESM 46KB, CJS 50KB, DTS 11KB     | —      |

### agent-event-service (v3.0.0-beta.24)

| 카테고리  | 발견                                                  | 심각도       |
| --------- | ----------------------------------------------------- | ------------ |
| 의존 방향 | 위반 없음 (의존 0개)                                  | OK           |
| SPEC      | 거의 비어있음 — 최소 요구사항 미충족                  | High         |
| SSOT      | core와 동일 타입 독립 정의 — SSOT 위반                | **Critical** |
| 번들      | `private: true` + `publishConfig.access: public` 모순 | Low          |
| 번들 크기 | ESM 3.2KB, CJS 4.9KB, DTS 6.4KB                       | —            |
