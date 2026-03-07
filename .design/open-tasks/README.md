# Open Tasks 가이드

이 디렉토리는 “남아 있는 일”과 “참고용 감사 산출물”만 둡니다.

## 파일 역할
- `CURRENT-TASKS.md`: 1-2주 내 처리할 실제 남은 작업만 기록
- `FUTURE-PROJECTS.md`: 장기 구상과 참고용 테마
- `ssot-duplicate-declarations-v*.json`: 중복/SSOT 감사 스냅샷

## 운영 원칙
- 완료된 작업은 `CURRENT-TASKS.md`에서 제거합니다.
- 현재 상태 규약은 각 workspace의 `docs/SPEC.md`가 소유합니다.
- 장기 항목이 실행 단계로 올라오면 `CURRENT-TASKS.md`로 승격합니다.
- 감사 JSON은 판단 보조 자료이며, 스펙이나 작업 체크리스트를 대체하지 않습니다.

## 정리 기준
- 단기 실행 계획은 하나의 문서(`CURRENT-TASKS.md`)로 유지합니다.
- 완료 이력은 여기 누적하지 않습니다.
- 임시 분석 메모는 `.design/tmp/`에 두고, 정식 합의가 끝나면 삭제하거나 owner 문서로 승격합니다.
