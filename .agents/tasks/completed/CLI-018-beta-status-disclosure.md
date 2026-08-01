---
title: 'CLI-018: 베타 상태 명시 (README + 마케팅 사이트)'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: apps/www, packages/agent-cli
depends_on: []
---

## Background

`@robota-sdk/agent-cli`는 `3.0.0-beta.67` 버전으로 배포 중이지만, `robota.io` 마케팅 페이지, docs, README 어디에도 "베타 소프트웨어"임이 명시되어 있지 않다.

사용자가 프로덕션 안정성을 기대하고 도입했다가 버그를 마주치면 이탈하거나 부정적인 리뷰를 남긴다. 베타 상태를 명시하면 기대 수준을 맞추고 버그 리포트를 장려하는 효과가 있다.

## 작업 항목

- `packages/agent-cli/README.md` 상단에 베타 뱃지 또는 경고 블록 추가

  ```md
  > ⚠️ **Beta Software**: This is `3.0.0-beta`. APIs and behavior may change.
  > Report issues at https://github.com/woojubb/robota/issues
  ```

- `apps/www` 메인 페이지 및 compare 페이지에 베타 배너 또는 상태 뱃지 추가
- `apps/docs` getting-started 페이지 상단에 베타 안내 callout 추가
- npm `dist-tag` 확인: `latest`가 아닌 `beta` 태그로 게시되어 있는지 확인 (`npm dist-tag ls @robota-sdk/agent-cli`)
  - `latest`로 게시되어 있다면 `beta` 태그로 재지정 고려

## Test Plan

- README, docs, www 각 위치에서 베타 상태 안내 노출 확인
- npm 페이지에서 버전 및 태그 정보 확인

## User Execution Test Scenarios

Not applicable — documentation and marketing changes.
