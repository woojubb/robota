# Design 문서 가이드 (최신)

`.design/`는 "정식 스펙"과 "장기 구상"을 관리합니다.

## 1) 단일 소스
- 작업 추적: `.agents/tasks/` (활성), `.agents/tasks/completed/` (아카이브)
- 정식 스펙: 각 패키지/앱의 `docs/SPEC.md` (예: `packages/dag-core/docs/SPEC.md`, `apps/web/docs/SPEC.md`)
- 장기 구상: `future/INDEX.md`
- 감사 산출물: `.design/*.json` (리포트 스냅샷, 계획 문서 아님)

## 2) 작성 규칙
- `.design` 문서는 한국어로 작성합니다(코드/식별자/파일 경로는 예외).
- 스펙에는 "현재 상태"만 기록합니다(히스토리/마이그레이션 로그 없음).
- 중복/충돌/반복을 만들지 않습니다(동일 내용은 한 파일에만).
- 완료된 작업은 `.agents/tasks/completed/`로 이동하고, 필요한 경우 각 `docs/SPEC.md`나 ADR로 승격합니다.
