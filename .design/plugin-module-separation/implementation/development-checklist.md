# Plugin vs Module 아키텍처 개요

> Plugin/Module 관련 실제 실행 계획이나 체크리스트가 필요할 경우, `CURRENT-TASKS.md`에 새 Priority 항목으로 작성해 주세요. 본 문서는 분리 원칙과 장기 로드맵 개요만 제공합니다.

## 핵심 원칙
- **선택적 확장**: Module/Plugin 없이도 Robota 기본 대화 가능
- **기존 Plugin 호환**: 기존 Plugin이 중단 없이 작동해야 함
- **Event-Driven**: Module ↔ Plugin 간 느슨한 결합 (EventEmitter/ActionTracking 이벤트)
- **점진적 확장**: BaseModule/Registry 기반을 유지한 채 실제 Module을 단계적으로 추가

## 현재 상태
- BaseModule, ModuleRegistry, ModuleTypeRegistry, Plugin Enhancement, Event 타입, 문서화 등 인프라 레이어는 완료
- 실제 Module(Storage, RAG, File Processing 등)은 아직 미구현(Phase 3 이후 작업)

## 장기 로드맵 (참고)
1. **Phase 3 – Module 구현**
   - Storage Module: 파일/메모리 backend, 인터페이스 표준화, EventEmitter 통합
   - RAG Module: 임베딩/인덱싱/검색, Storage 의존성 활용
   - File Processing Module: PDF/이미지/오디오 파싱, 텍스트 추출
2. **Phase 4 – 고급 기능**
   - ModuleBuilder/Factory 시스템, 런타임 등록 지원
   - 개발자 디버깅 도구(의존성 그래프, 이벤트 추적, 성능 프로파일링)
3. **성공 기준**
   - 실제 사용 가능한 Module 3개 이상, Module-Plugin 상호작용 검증
   - 개발자 친화적 API 및 문서화

## 위험 및 대응
- 복잡성 증가 → 단순 Module부터 시작, 단계별 도입
- 성능 영향 → 각 Module의 성능 모니터링 및 최적화
- 개발자 경험 → 빌더/팩토리/디버깅 도구 제공

---

Module 관련 작업이 실행 단계로 올라오면 `CURRENT-TASKS.md`에서 세부 일정과 검증 절차를 작성하고, 이 문서는 참고용 개요만 유지합니다.