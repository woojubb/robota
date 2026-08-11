# CLI2-010: 슬래시 자동완성 설명 텍스트 말줄임표 처리

- **Status**: in-progress
- **Created**: 2026-05-11
- **Branch**: fix/tui-slash-autocomplete-desc-truncation
- **Scope**: packages/agent-transport-tui

## Objective

슬래시 자동완성 팝업에서 description이 긴 경우 여러 줄로 줄바꿈되는 문제를 수정한다.
60자 초과 시 슬라이스 + `…`로 한 줄 처리.

## Plan

- [ ] `SlashAutocomplete.tsx`에 `MAX_DESC_LENGTH` + `truncate` 헬퍼 추가
- [ ] `CommandRow`에서 `truncate(cmd.description ?? '')` 사용
- [ ] `SlashAutocomplete.test.tsx` 단위 테스트 작성
- [ ] `pnpm typecheck` 통과 확인
- [ ] `pnpm --filter @robota-sdk/agent-transport-tui test` 회귀 없음 확인
- [ ] 백로그 증거 필드 기입 후 done 처리

## Progress

### 2026-05-11

- 브랜치 생성: fix/tui-slash-autocomplete-desc-truncation
- 태스크 파일 생성

## Decisions

- 고정 상수 60자 사용 (백로그 명세 기준)

## Blockers

(없음)

## Result

(미완)
