---
title: agent-playground monolith decomposition (26 files)
status: backlog
priority: low
urgency: later
created: 2026-03-27
packages:
  - agent-playground
---

## 요약

agent-playground에 300줄 초과 프로덕션 파일 26개. 레포 전체에서 가장 많은 위반.

## 위반 파일

### hooks (3 files)

- `hooks/use-websocket-connection.ts` (471줄)
- `hooks/use-chat-input.ts` (460줄)
- `hooks/use-robota-execution.ts` (396줄)

### components/playground (15 files)

- `agent-configuration-block.tsx` (467줄)
- `project-browser.tsx` (422줄)
- `execution-tree-debug.tsx` (421줄)
- `error-panel.tsx` (403줄)
- `tool-container-block.tsx` (383줄)
- `template-gallery-data.ts` (371줄)
- `block-visualization/block-visualization-panel.tsx` (362줄)
- `code-editor-templates.ts` (350줄)
- `block-visualization/block-tree.tsx` (336줄)
- `agent-container-block.tsx` (327줄)
- `usage-monitor.tsx` (323줄)
- `execution-tree-visualizer.tsx` (321줄)
- `individual-plugin-block.tsx` (318줄)
- `chat-interface.tsx` (307줄)
- `components/ui/accessibility.tsx` (303줄)

### lib/playground (7 files)

- `websocket-client.ts` (451줄)
- `robota-executor.ts` (447줄)
- `execution-subscriber.ts` (443줄)
- `project-manager.ts` (387줄)
- `block-tracking/block-hooks.ts` (324줄)
- `code-analyzer.ts` (320줄)
- `demo-execution-data.ts` (310줄)

### contexts (1 file)

- `contexts/playground-context.tsx` (390줄)

## 테스트 계획

- playground는 테스트가 제한적이므로 빌드 성공이 주요 검증 수단
- `pnpm --filter @robota-sdk/agent-playground build` 전후 성공 확인
- 분해 후 300줄 초과 파일 0개 확인
