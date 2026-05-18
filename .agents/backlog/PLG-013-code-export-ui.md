---
title: 'PLG-013: Code Export UI — 코드 미리보기 패널 + syntax highlight + Copy 버튼'
status: todo
created: 2026-05-19
priority: high
urgency: later
area: apps/agent-web, packages/agent-playground
depends_on: [PLG-012]
---

## Background

PLG-012에서 코드 생성 엔진이 구현되면, 사용자가 생성된 코드를 쉽게 확인하고
클립보드에 복사할 수 있는 UI가 필요하다.

이것이 PLG-008의 핵심 사용자 경험이다:

- 캔버스에서 agent 조립 → "Copy Code" 클릭 → TypeScript 코드를 새 프로젝트에 붙여넣기 → 바로 실행

## Goals

1. `CodeExportPanel` 컴포넌트 구현:
   - Assembly 상태 변경 시 실시간으로 코드 미리보기 업데이트 (debounce 300ms)
   - Syntax highlight: `shiki` 또는 `prism-react-renderer` 사용 (TypeScript 하이라이팅)
   - 줄 번호 표시
   - 다크 테마 (Playground 전체 테마와 일치)

2. "Copy Code" 버튼:
   - 클릭 시 `navigator.clipboard.writeText()` 호출
   - 복사 완료 후 버튼 아이콘이 체크마크로 2초간 변경 후 복원
   - 클립보드 API 미지원 환경: 텍스트 선택 fallback

3. Playground 레이아웃에 CodeExportPanel 통합:
   - 위치: 채팅/타임라인 영역 하단 또는 별도 탭 (탭 방식 권장)
   - 탭: "Chat" | "Code Export"
   - Code Export 탭에 CodeExportPanel + Copy 버튼

4. Assembly Canvas에 변경사항이 생길 때마다 코드 자동 갱신:
   - AgentNode provider/model/systemPrompt 수정
   - ToolNode 추가/제거
   - 에이전트 없을 때: "Create an agent to generate code" 안내 문구

5. "패키지 설치 가이드" 섹션 추가 (코드 하단):
   ```
   # Install dependencies
   npm install @robota-sdk/agent-framework @robota-sdk/agent-provider
   ```

## Non-Goals

- 코드 편집 기능 (read-only 미리보기)
- 여러 언어 지원 (TypeScript만)
- 파일 다운로드 (.ts 파일로 저장)
- 코드 실행 in-browser

## Architecture

```
packages/agent-playground/src/components/playground/
└── code-export/
    ├── code-export-panel.tsx     ← NEW: 미리보기 + Copy 버튼
    ├── syntax-highlighter.tsx    ← NEW: shiki/prism 래퍼
    └── install-guide.tsx         ← NEW: npm install 가이드

apps/agent-web/src/app/playground/
└── page.tsx                  ← 탭에 CodeExportPanel 추가
```

## Test Plan

- 단위 테스트:
  - Assembly 상태 변경 → `generateAgentCode()` 호출 → 코드 업데이트 확인
  - "Copy Code" 버튼 클릭 → `navigator.clipboard.writeText()` 호출 확인 (mock)
  - 에이전트 없을 때 안내 문구 표시
- Playwright E2E:
  - 에이전트 생성 + tool 연결 → Code Export 탭 클릭 → 코드 확인
  - "Copy Code" 클릭 → 클립보드 내용 검증 (`page.evaluate(() => navigator.clipboard.readText())`)
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: Code Export 전체 흐름

**Prerequisites**: PLG-009, PLG-010, PLG-012 완료, `pnpm dev` (agent-web)

**Steps**:

1. `http://localhost:7071/playground` 접속
2. "Create Agent" → Provider: OpenAI, Model: gpt-4o-mini, System Prompt: "You are a helpful assistant." → Create
3. Tools 패널에서 "Current Time" tool 캔버스에 연결
4. "Code Export" 탭 클릭
5. 생성된 TypeScript 코드 확인
6. "Copy Code" 버튼 클릭
7. 새 파일에 붙여넣기 후 내용 확인

**Expected observable result**:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { getCurrentTimeTool } from '@robota-sdk/agent-tools/current-time';

const session = new InteractiveSession({
  provider: {
    name: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
  },
  tools: [getCurrentTimeTool],
  systemPrompt: 'You are a helpful assistant.',
});

const response = await session.run('Your message here');
console.log(response);
```

- syntax highlight 적용 (키워드, 문자열, import 색상 구분)
- Copy 버튼 클릭 후 체크마크로 변경
- 클립보드에 동일 코드 복사됨

**Evidence**: `<스크린샷 + 클립보드 내용 — 구현 후 기입>`
