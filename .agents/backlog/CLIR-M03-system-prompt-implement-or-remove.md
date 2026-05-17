---
title: 'CLIR-M03: --system-prompt 미구현 플래그 완전 구현 또는 완전 제거'
status: todo
created: 2026-05-17
priority: medium
urgency: later
area: packages/agent-cli, packages/agent-framework
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #M-03

CLI-002(done, PR #356)에서 `cli.ts`에 "(미지원)" 경고를 추가했으나,
`print-mode.ts:38–41`에 여전히 TODO와 `process.stderr.write` 직접 호출이 잔존한다.

```typescript
// print-mode.ts:38–41 — 현재 상태
// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
if (opts.systemPrompt) {
  process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
}
```

`IParsedCliArgs`와 `ISessionRunOptions`에 `systemPrompt` 필드가 있으나 실제로 연결되지 않는다.
TUI 모드에서도 이 옵션이 연결되는지 확인이 필요하다.

## 선택지

**옵션 A — 완전 구현:** `IInteractiveSessionStandardOptions`에 `systemPrompt?: string` 필드를 추가하고
print-mode와 tui-mode 모두에서 `InteractiveSession` 생성 시 전달한다.
agent-framework SPEC.md 업데이트 필요.

**옵션 B — 완전 제거:** `cli-args.ts`에서 `--system-prompt` 파싱을 삭제하고,
`IParsedCliArgs`, `ISessionRunOptions`에서 `systemPrompt` 필드를 제거한다.
print-mode.ts의 TODO 블록도 삭제한다.

구현 전 **설계 컨펌 필요** (옵션 A vs B).

## 규칙 참조

- AGENTS.md — "deprecated 금지. 외부 소비자 없으면 삭제, 내부 소비자 있으면 마이그레이션 완료."
- CLIR-H01과 연계: 옵션 A 구현 시 `process.stderr.write` → 적절한 `terminal` 출력으로 교체 필요

## Test Plan

**옵션 A 구현 시:**

- [ ] `pnpm --filter @robota-sdk/agent-framework typecheck` 0 errors
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `grep -n "TODO.*system-prompt" packages/agent-cli/src/modes/print-mode.ts` — 결과 없음
- [ ] `systemPrompt` 옵션이 실제로 `InteractiveSession`에 전달됨을 unit test로 확인
- [ ] agent-framework SPEC.md 업데이트 확인

**옵션 B 제거 시:**

- [ ] `grep -rn "systemPrompt" packages/agent-cli/src/` — 결과 없음
- [ ] `robota --help` 출력에 `--system-prompt` 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors

## User Execution Test Scenarios

**옵션 A 구현 시:**

### Scenario 1 — --system-prompt 플래그 동작 확인

**Prerequisites**: `pnpm build`, API 키 설정 완료

**Steps**:

```bash
echo "What language are you speaking?" | robota --print --system-prompt "Always respond in French"
```

**Expected**: AI가 프랑스어로 응답함.

**Evidence**: (구현 후 채울 것)

---

**옵션 B 제거 시:**

### Scenario 1 — --help에서 --system-prompt 미노출 확인

**Prerequisites**: `pnpm build`

**Steps**:

```bash
robota --help
```

**Expected**: `--system-prompt` 옵션이 help 출력에 없음.

**Evidence**: (구현 후 채울 것)
