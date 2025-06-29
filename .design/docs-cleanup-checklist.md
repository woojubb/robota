# 문서 정리 및 배포 준비 체크리스트

## 개요
현재 Robota SDK의 문서가 다음과 같은 문제점들이 있어 배포 전 정리가 필요함:
1. 패키지별 README.md 누락
2. Deprecated 패키지 참조 (`@robota-sdk/core` → `@robota-sdk/agents`)
3. publish.js 스크립트와 실제 패키지 구조 불일치
4. 중복된 문서 구조

## 작업 우선순위

### Phase 1: 패키지 구조 파악 및 스크립트 수정
- [x] 현재 활성 패키지 목록 확인
- [x] `scripts/publish.js` 업데이트
- [x] `package.json`의 build 스크립트 검증

### Phase 2: 각 패키지 README.md 생성 ✅
- [x] `packages/agents/README.md` 생성 (기존 docs/README.md 기반)
- [x] `packages/openai/README.md` 생성
- [x] `packages/anthropic/README.md` 생성
- [x] `packages/google/README.md` 생성
- [x] `packages/team/README.md` 생성
- [x] `packages/sessions/README.md` 생성
- [x] `packages/tools/README.md` 생성
- [x] `packages/core/README.md` 생성

### Phase 3: Deprecated 패키지 참조 수정 ✅
- [x] `docs/**/*.md` 파일들에서 `@robota-sdk/core` → `@robota-sdk/agents` 변경
- [x] `packages/*/docs/*.md` 파일들에서 deprecated 참조 수정
- [x] Import 문과 설치 명령어 업데이트

### Phase 4: 문서 구조 정리
- [ ] 중앙 문서(`./docs/`)와 패키지별 문서 역할 명확화
- [ ] 중복된 내용 제거 또는 통합
- [ ] API 레퍼런스 최신화

### Phase 5: 배포 준비 검증 ✅
- [x] `pnpm run build:all` 테스트 (성공)
- [x] 각 패키지의 `package.json` 검증
- [x] `publishConfig` 설정 확인
- [x] Changeset 동작 확인 (새 @robota-sdk/agents 패키지만 배포 예정)

### Phase 6: 최종 검증 및 배포
- [ ] 전체 빌드 테스트
- [ ] 문서 링크 검증
- [ ] 배포 준비 완료 확인

---

## 작업 진행 상황

### ✅ 완료된 작업
- Phase 1: 패키지 구조 파악 및 스크립트 수정 완료
- Phase 2: 각 패키지 README.md 생성 완료 (8개 패키지)
- Phase 3: Deprecated 패키지 참조 수정 완료 (주요 문서들)
- Phase 5: 배포 준비 검증 완료 (빌드 및 배포 스크립트 테스트 성공)

### 🔄 진행 중인 작업
_(현재 진행 중인 작업 표시)_

### ❌ 발견된 추가 문제점
_(작업 중 발견되는 추가 문제점들)_

---

## 참고 정보

### 현재 패키지 구조
```
packages/
├── agents/       # 통합된 core 기능
├── anthropic/    # Anthropic 프로바이더
├── core/         # 기존 core (사용 여부 확인 필요)
├── google/       # Google AI 프로바이더
├── openai/       # OpenAI 프로바이더
├── sessions/     # 세션 관리
├── team/         # 팀 협업
└── tools/        # 도구 시스템
```

### 주요 명령어
```bash
# 빌드 테스트
pnpm run build:all

# 배포 (준비 완료 후)
pnpm run publish:packages

# 개별 패키지 빌드
pnpm --filter @robota-sdk/agents build
``` 