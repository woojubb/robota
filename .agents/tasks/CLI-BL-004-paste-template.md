# CLI 텍스트 붙여넣기 (Paste Template)

- **Status**: todo
- **Created**: 2026-03-23
- **Branch**: feat/cli-bl-004-paste-template (예정)
- **Scope**: packages/agent-cli

## Objective

Claude Code 스타일의 붙여넣기 처리 구현. 사용자가 멀티라인 텍스트를 붙여넣으면
입력창에 원본 대신 `[Pasted text #1 +N lines]` 라벨을 표시하고,
제출 시 라벨을 실제 내용으로 치환하여 onSubmit에 전달한다.

## Plan

- [ ] `CjkTextInput`에 `onPaste?: (text: string) => void` prop 추가
  - `useInput` 콜백에서 멀티라인 감지: `input.length > 1 && input.includes('\n')`
  - 멀티라인이면 `onPaste(input)` 호출 (pasteStore 미포함, 순수 이벤트 전달)
  - 싱글라인 붙여넣기는 기존 인라인 삽입 동작 유지
- [ ] `InputArea`에 paste 로직 추가
  - `pasteStore: Map<number, string>` 내부 상태 관리
  - `onPaste` 핸들러: 내용을 store에 저장, `setValue`로 라벨 삽입
    - 라벨 형식: `[Pasted text #<id> +<N> lines]`
    - id는 제출 후 리셋 (1부터 재시작)
  - `handleSubmit`: 제출 전 `expandPasteLabels()` 실행 후 store 초기화
- [ ] `expandPasteLabels` 유틸 구현
  ```ts
  const PASTE_LABEL_RE = /\[Pasted text #(\d+) \+\d+ lines\]/g;
  function expandPasteLabels(text: string, store: Map<number, string>): string {
    return text.replace(PASTE_LABEL_RE, (_, id) => store.get(Number(id)) ?? '');
  }
  ```
- [ ] 테스트 작성 (vitest)
  - 멀티라인 붙여넣기 → 라벨 삽입 확인
  - 제출 시 라벨 → 원본 내용 치환 확인
  - 싱글라인 붙여넣기 → 인라인 삽입 확인
  - 라벨 편집/삭제 시 → 빈 문자열로 치환 (의도된 동작)
- [ ] 빌드 및 타입체크 통과 확인

## Decisions

- **아키텍처 B안 채택**: `CjkTextInput`은 onPaste 이벤트만 발행, pasteStore 소유는 `InputArea`
  - 이유: 관심사 분리. `CjkTextInput`은 입력 감지만, 비즈니스 로직은 `InputArea`가 담당
- **싱글라인 paste**: 라벨 처리 없이 인라인 삽입 (기존 동작 유지)
- **라벨 편집/삭제 시 동작**: 빈 문자열로 치환 (silent break, 의도된 설계)
- **라벨 번호 리셋**: 제출 후 초기화 (매 대화 턴마다 #1부터 시작)
- **멀티라인 감지 조건**: `input.length > 1 && input.includes('\n')`
  - Ink의 `useInput`이 붙여넣기를 단일 콜백으로 전달하므로 이 조건으로 충분

## Files to Change

- `packages/agent-cli/src/ui/CjkTextInput.tsx`
- `packages/agent-cli/src/ui/InputArea.tsx`

## Blockers

- (없음)

## Result

(완료 시 작성)
