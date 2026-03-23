---
title: PLUG-BL-001 Marketplace source format compatibility
status: in-progress
priority: high
created: 2026-03-23
packages:
  - agent-sdk
---

## 문제

외부 marketplace (e.g., obra/superpowers-marketplace)의 plugin source 형태가 우리 코드와 호환되지 않아 설치 시 빈 디렉토리만 생성됨.

### 실제 manifest source 형태 (Claude Code 생태계)

```json
{ "source": "url", "url": "https://github.com/obra/superpowers.git" }
```

### 우리 코드가 기대하는 형태

```json
{ "type": "url", "url": "..." }
{ "type": "github", "repo": "..." }
```

### 문제점

1. 키 불일치: manifest는 `source` 키, 코드는 `type` 키로 분기
2. git URL 미구현: `.git`으로 끝나는 URL은 git clone으로 처리 가능하지만 "not yet supported" 에러
3. 빈 디렉토리 남김: 어느 조건에도 매칭 안 되면 빈 targetDir만 생성되고 에러 없이 종료
