---
title: 'CLI-B04: /context list와 status bar 컨텍스트 수치의 데이터 소스 불일치'
status: todo
created: 2026-05-31
priority: medium
urgency: soon
area: packages/agent-command, packages/agent-framework, packages/agent-cli
depends_on: []
---

## 증상

`/context list` 실행 결과:

```
System:

  Context references:
  AGENTS.md [system, active] 10,205 B
  CLAUDE.md [system, active] 134 B
```

Status bar 표시:

```
Context: 4% (41.1K/1M)
```

## 근본 문제: SSOT 위반

두 UI 요소가 서로 다른 데이터 소스에서 수치를 읽는다:

| UI                        | 현재 데이터 소스                           | 단위   |
| ------------------------- | ------------------------------------------ | ------ |
| `/context list` 파일 크기 | `IContextReferenceItem.size` (파일 바이트) | bytes  |
| Status bar `Context:`     | `InteractiveSession`의 실제 토큰 사용량    | tokens |

기능은 분리되어 있지만 둘 다 "컨텍스트가 얼마나 사용됐는가"를 표현한다. SSOT가 아니므로 사용자가 두 수치를 연결할 수 없고, 수치 불일치의 원인도 알 수 없다.

## 해결 방향: 공통 데이터 소스 확립

`IContextReferenceItem`에 `tokenCount?: number` 필드를 추가하고, 파일 로드 시점에 실제 토큰 수를 계산해 기록한다. `/context list`와 status bar 모두 이 단일 소스를 참조한다.

### 변경 범위

1. **`IContextReferenceItem` 확장** (`agent-framework`)
   - `tokenCount?: number` 필드 추가
   - 시스템 컨텍스트 파일 로드 시(`recordSystemContextFiles`) 토큰 수 계산 후 기록

2. **`/context list` 출력 변경** (`agent-command`)
   - 바이트 크기 대신(또는 함께) 토큰 수 표시
   - `tokenCount`가 있으면 토큰 수 우선 표시

   ```
   AGENTS.md [system, active] 2,551 tokens
   CLAUDE.md [system, active]    34 tokens
   ```

3. **Status bar와의 정합성**
   - Status bar는 전체 대화(시스템 프롬프트 + 히스토리)의 누적 토큰을 표시 — 이는 별도 측정값이므로 단위 레이블을 명시: `41.1K tokens used`
   - `/context list` 합계를 status bar 수치의 부분집합으로 명확히 표현할 수 있으면 표시

## Done gate

- [ ] `IContextReferenceItem`에 `tokenCount` 필드 추가 및 토큰 계산 연동
- [ ] `/context list` 출력이 토큰 수를 표시함
- [ ] Status bar 수치와 `/context list` 합계의 관계를 사용자가 이해할 수 있음
- [ ] `pnpm --filter @robota-sdk/agent-framework test` 통과
- [ ] `pnpm --filter @robota-sdk/agent-command test` 통과

## User Execution Test Scenarios

### Scenario 1: 단위 통일 확인

1. AGENTS.md가 있는 프로젝트에서 `pnpm robota` 실행
2. `/context list` 입력
3. **기대**: 파일 항목이 토큰 수로 표시되고, status bar 수치와 비교 가능함
