---
title: 패키지 번들링 감사 — 사이즈, 불필요 요소, 참조 방향 검증
status: backlog
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

## 요약

각 패키지의 번들링 상태를 감사하여 번들 사이즈가 적절한지, 불필요한 요소가 포함되지 않았는지, 패키지 간 의존 방향이 올바르게 번들되는지 확인.

## 검증 항목

### 1. 번들 사이즈

- 각 패키지의 dist/ 크기 확인
- ESM, CJS, DTS 별 사이즈
- 이전 버전 대비 급격한 증가가 없는지

### 2. 불필요 요소

- 테스트 파일이 dist에 포함되지 않는지
- 개발 전용 코드(debug log 등)가 번들에 남아있지 않는지
- 사용하지 않는 export가 tree-shaking 되는지
- devDependencies가 번들에 포함되지 않는지

### 3. 번들 방향 및 참조 방향

- agent-core가 다른 agent-\* 패키지를 참조하지 않는지
- 단방향 의존: cli → sdk → sessions → core
- provider가 core만 참조하는지
- 순환 참조가 없는지

### 4. 패키지별 확인

- tsup 설정이 적절한지 (external, format, dts)
- package.json의 exports/main/types가 올바른지
- dist/ 구조가 일관적인지
