# Design 문서 가이드 (최신)

`.design/`는 “정식 스펙”과 “남은 작업 목록”을 분리해 관리합니다.

## 1) 단일 소스
- 남은 작업 목록: `open-tasks/CURRENT-TASKS.md` (남은 작업([ ])만)
- 정식 스펙: 각 패키지/앱의 `docs/SPEC.md` (예: `packages/dag-core/docs/SPEC.md`, `apps/web/docs/SPEC.md`)
- 장기 구상: `future/INDEX.md`

## 2) 작성 규칙
- `.design` 문서는 한국어로 작성합니다(코드/식별자/파일 경로는 예외).
- 스펙에는 “현재 상태”만 기록합니다(히스토리/마이그레이션 로그 없음).
- 중복/충돌/반복을 만들지 않습니다(동일 내용은 한 파일에만).
