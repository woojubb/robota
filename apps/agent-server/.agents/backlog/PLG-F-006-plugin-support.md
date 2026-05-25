---
title: 'PLG-F-006: 플러그인 지원 — 플러그인 노드 + 카탈로그 + 코드 생성'
status: todo
created: 2026-05-19
priority: low
urgency: later
area: packages/agent-playground, apps/agent-server
depends_on: [PLG-F-002, PLG-F-003]
---

## Background

`agent-framework`는 `BundlePluginLoader`를 통해 npm 패키지로 배포된 플러그인을 지원한다.
플러그인은 커맨드·스킬·도구·훅을 번들로 제공하는 단위다.

현재 Playground는 플러그인 개념이 없다. agent-framework 수준의 playground로서
플러그인을 시각적으로 조립하고 코드로 내보낼 수 있어야 한다.

## Goals

1. `IPlaygroundPluginMeta` 타입 정의:

   ```typescript
   interface IPlaygroundPluginMeta {
     id: string;
     packageName: string; // npm 패키지명 (@robota-sdk/plugin-xxx)
     name: string;
     description: string;
     version: string;
     capabilities: string[]; // ['tools', 'skills', 'commands']
     tags: string[];
   }
   ```

2. 플러그인 카탈로그 정의:
   - `packages/agent-playground/src/plugins/catalog.ts`
   - 초기 등록: placeholder 플러그인 1~2개

3. Assembly Canvas — `PluginNode` 커스텀 노드:
   - 색상: 에메랄드/틸 계열 (ToolNode, SkillNode과 구분)
   - 아이콘: `Package` (lucide-react)
   - AgentNode 왼쪽에 SkillNode 아래 배치

4. 오른쪽 사이드바 — Tools / Skills / Plugins 3탭:
   - Plugins 탭 추가
   - 플러그인 카드: packageName, 제공 capability 배지, 드래그 핸들

5. 코드 생성 (PLG-F-001 이후):

   ```typescript
   import { InteractiveSession, PluginCommandSource } from '@robota-sdk/agent-framework';
   import { BundlePluginLoader } from '@robota-sdk/agent-framework';
   // ...
   const pluginLoader = new BundlePluginLoader({ cwd: process.cwd() });
   const session = new InteractiveSession({
     // ...
     commandModules: [
       createBuiltinCommandModule(),
       await pluginLoader.load('@robota-sdk/plugin-xxx'),
     ],
   });
   ```

6. 서버 플러그인 카탈로그 API:
   - `GET /api/playground/catalog/plugins`

## Non-Goals

- 실제 npm 플러그인 설치/실행 (보안상 샌드박스 필요 — 별도 백로그)
- 플러그인 마켓플레이스 연동
- 플러그인 개발 도구

## Architecture

```
packages/agent-playground/src/
├── plugins/
│   ├── types.ts              ← IPlaygroundPluginMeta
│   └── catalog.ts            ← placeholder 플러그인 목록
└── components/playground/
    ├── assembly-canvas/nodes/
    │   └── plugin-node.tsx   ← NEW
    └── right-panel/          ← Tools/Skills/Plugins 3탭으로 확장

apps/agent-server/src/catalog/
└── plugins.ts                ← NEW: GET /catalog/plugins
```

## Test Plan

- 단위 테스트:
  - PluginNode 렌더링 검증
  - 코드 생성: 플러그인 포함 시 `BundlePluginLoader` 패턴 생성 확인
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 플러그인 탭 확인 및 캔버스 추가

**Prerequisites**: PLG-F-002, PLG-F-003 완료, 에이전트 생성

**Steps**:

1. 오른쪽 사이드바 "Plugins" 탭 클릭
2. 플러그인 카드 드래그 → 캔버스 드롭

**Expected observable result**:

- PluginNode가 AgentNode에 에메랄드 색상 엣지로 연결됨
- PluginNode가 ToolNode, SkillNode와 시각적으로 구분됨

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: 플러그인 포함 Code Export

**Steps**:

1. 플러그인 추가 후 "Code Export" 탭 클릭

**Expected observable result**:

- 생성 코드에 `BundlePluginLoader` + `pluginLoader.load(...)` 패턴 포함

**Evidence**: `<스크린샷 — 구현 후 기입>`
