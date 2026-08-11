# INFRA-BL-009 아키텍처 리뷰: 빌드 도구 마이그레이션

**리뷰어**: 시스템 아키텍트 관점  
**리뷰 대상**: `.agents/tasks/INFRA-BL-009-build-tool-migration.md`  
**리뷰 일자**: 2026-05-15

---

## 1. 설계 완성도 평가

### 1.1 Spec-first 준수 여부 — 부분 위반

빌드 도구 변경은 모든 57개 패키지의 **export 계약(main, types, exports, bin)** 을 직접 변경하는 인프라 계약 경계 변경이다. `spec-workflow.md` §Spec-First Development에 따르면:

> Any change touching a contract boundary ... MUST update or create the governing spec BEFORE writing implementation code.

현재 태스크 파일에는:

- `build-types-ordered.mjs` 같은 핵심 빌드 스크립트의 계약 소유자가 명시되지 않음
- 마이그레이션 후 갱신해야 할 SPEC/아키텍처 문서 목록 없음
- 인프라 계약 변경이 `.agents/specs/` 또는 관련 아키텍처 맵에 반영될 계획 없음

**결론**: 계약 결정이 태스크 파일 산문에만 존재한다. 설계 문서(`.design/`)로 승격되거나 SPEC으로 확정될 경로가 없다.

### 1.2 Research-first 준수 여부 — 부분 위반

`research.md` §Research-First Implementation에 따르면 외부 레퍼런스, 비교 제품, comparable 오픈소스 프로젝트를 조사해야 한다.

현재 조사 내용:

- tsdown/unbuild/tsup 버전 스냅샷 수준 기록 — **존재하나 불충분**
- tsdown `outExtensions` 우회 가능성 미조사
- unbuild의 browser/node dual 빌드 지원 수준 미조사
- 동일 규모 모노레포(예: tRPC, Radix UI, Effect)의 빌드 도구 선택 비교 없음
- DTS 생성 전략(2-pass vs monorepo-native topo sort)의 도구별 대체 방안 미조사

**결론**: 버전 확인 수준 조사이고, 의사결정 근거가 될 `## Prior Art Research` 섹션이 없다.

### 1.3 아키텍처 문서 계획 — 누락

마이그레이션 완료 후 갱신해야 할 문서:

- `.agents/project-structure.md`: 빌드 도구 언급 없으나 패키지 구조에 영향
- 각 패키지 `tsup.config.ts` → 신규 config 파일 형식 (SPEC 계약 변경)
- `scripts/build-types-ordered.mjs`: 도구 교체 시 이 스크립트의 역할 변화 미명시
- `scripts/harness/check-build-output-contracts.mjs`: harness 계약 검증 로직 자체 업데이트 필요 여부

현재 태스크 파일에는 이 중 어느 것도 언급되지 않는다.

---

## 2. 아키텍처 리스크 분석

### 2.1 Critical: DTS 출력 확장자 불일치

현재 계약:

```
dist/node/index.d.ts   ← 모든 패키지 types 필드
dist/node/index.js     ← ESM entry
dist/node/index.cjs    ← CJS entry
```

tsdown 기본 동작 (PoC 결과):

```
dist/index.mjs         ← ESM (확장자 불일치)
dist/index.d.mts       ← DTS (확장자 불일치, types 필드 파손)
```

이 불일치는 57개 패키지의 소비자(다른 패키지, npm 사용자, TypeScript resolution)를 모두 파손한다. `outExtensions` 설정으로 우회 가능하나, 태스크 파일에 이 우회책이 명시되어 있지 않다.

### 2.2 Critical: 레이어별 이질성 미반영

현재 57개(+apps) 패키지는 빌드 복잡도가 다르다:

| 유형           | 대표 패키지                 | 특이사항                    |
| -------------- | --------------------------- | --------------------------- |
| 기본 node-only | agent-core, agent-sessions  | 단순 ESM+CJS                |
| Browser dual   | agent-core, agent-web       | browser/node 분리 빌드 필수 |
| CLI bin        | agent-cli                   | bin entry 보존 필수         |
| React/JSX      | agent-playground, agent-web | JSX transform 필요          |
| Multi-entry    | agent-sdk                   | 여러 entry point            |

태스크 파일의 "leaf 패키지 PoC" 계획은 유형 분류 없이 단순 순서(leaf → 전체)만 언급한다. 레이어별 이질성이 반영되지 않으면 PoC가 leaf에서 성공해도 browser dual, bin, multi-entry 패키지에서 실패할 수 있다.

### 2.3 High: Harness silent failure 위험

현재 `check-build-output-contracts.mjs`는 `package.json`의 경로 패턴만 검증한다. 실제 dist 파일 존재 여부를 확인하지 않으면 도구가 파일을 다른 경로에 생성해도 계약 체크가 통과할 수 있다. 마이그레이션 도중 harness가 silent pass를 낼 위험이 있다.

### 2.4 Medium: 토폴로지 정렬 DTS 빌드 대체 미설계

현재 `build-types-ordered.mjs`는 workspace 의존성 그래프를 분석해 DTS 빌드 순서를 보장한다(agent-core → agent-sessions → agent-sdk 등). 신규 도구가 이 토폴로지 정렬을 자체 처리할 수 있는지, 아니면 스크립트를 유지해야 하는지 미설계 상태이다.

### 2.5 Medium: 롤백 계획 부재

57개 패키지 일괄 마이그레이션의 롤백 전략이 없다. tsup 병행 유지 기간, 패키지별 단계적 전환, 긴급 되돌림 절차가 명시되지 않았다.

---

## 3. 마이그레이션 전략 평가

### 3.1 'blocked' 전략의 적절성 — 조건부 적절

tsdown 1.0 미출시 이유로 blocked 상태를 유지하는 것은 타당하나, blocked 해제 조건이 너무 좁다:

- 현재 조건: "tsdown 1.0 또는 출력 계약 호환성 확보"
- 누락 조건:
  - unbuild가 현재 계약을 만족하는지 PoC 결과로 판단하는 경로 없음
  - tsup 8.5.x의 실질적 유지보수 수준 재평가 기준 없음
  - 도구 선정 Decision Matrix 부재

### 3.2 PoC 계획의 구조적 충분성 — 부족

현재 계획: "build contract guard 기준 → 1-2개 leaf 패키지 PoC → 전체 전환"

미비 사항:

- leaf 패키지 선정 기준 없음 (agent-core? auth? 가장 단순한 것?)
- PoC 성공 기준 없음 (빌드 통과만? 실제 소비 테스트까지?)
- 단계 간 승인 게이트 없음
- 병렬 빌드 성능 측정 계획 없음 (CI 시간 비교)

---

## 4. 아키텍처 개선안

### 4.1 설계 문서 승격

현재 태스크 파일에 산문으로 기록된 조사 결과와 계약 결정을 `.design/build-tool-migration-design.md`로 승격해야 한다. 태스크 파일은 실행 추적용으로 두고, 계약 결정은 설계 문서에서 관리한다.

### 4.2 패키지 유형 분류 및 단계별 마이그레이션

```
단계 0 (현재): 도구 선정 연구 완료 → Decision Matrix 작성
단계 1: node-only 단순 패키지 PoC (auth, credits 등 leaf)
단계 2: node-only 전체 패키지 (agent-core, agent-sessions 등)
단계 3: browser dual 패키지 (agent-core, agent-web)
단계 4: bin 패키지 (agent-cli)
단계 5: apps/ 패키지
```

각 단계는 독립 PR이며, 이전 단계 harness 통과가 선행 조건이다.

### 4.3 Harness 강화

마이그레이션 전 `check-build-output-contracts.mjs`를 강화해야 한다:

- 경로 패턴 체크 + 실제 파일 존재 확인 (dist file existence check)
- DTS 확장자 체크 (`.d.ts` vs `.d.mts` 구분)
- browser 빌드 파일 존재 확인

### 4.4 도구 선정 Decision Matrix

| 기준               | tsdown                     | unbuild | Rollup+tsc |
| ------------------ | -------------------------- | ------- | ---------- |
| 1.0 안정성         | 미출시                     | 3.6.1   | N/A        |
| browser dual 빌드  | 확인 필요                  | 지원    | 수동 구성  |
| outExtensions 제어 | 지원(UserConfig)           | 제한적  | 완전 제어  |
| DTS topo 정렬      | 미지원(외부 스크립트 유지) | 미지원  | 미지원     |
| 마이그레이션 비용  | 낮음 (tsup 호환)           | 중간    | 높음       |

### 4.5 blocked 해제 조건 명확화

```
blocked 해제 조건 (택 1):
1. tsdown 1.0 출시 + outExtensions로 계약 보존 PoC 통과
2. unbuild로 browser dual + ESM+CJS + DTS 출력 계약 PoC 통과
3. 유지보수 모드인 tsup이 실질적 결함을 발생시킬 경우 즉시 해제
```

---

## 5. 종합 평가

| 항목                | 등급 | 설명                                         |
| ------------------- | ---- | -------------------------------------------- |
| Spec-first 준수     | D    | 계약 변경이 태스크 파일에만 존재             |
| Research-first 준수 | C    | 버전 스냅샷 수준, Prior Art 섹션 없음        |
| 아키텍처 문서 계획  | F    | 누락                                         |
| 리스크 식별         | C    | DTS 불일치 언급했으나 레이어별 이질성 미반영 |
| 마이그레이션 전략   | C    | 단계 있으나 기준/게이트 없음                 |
| 롤백 계획           | F    | 누락                                         |

**핵심 결론**: INFRA-BL-009는 현재 탐색 노트 수준이며, 실행 가능한 아키텍처 설계가 아니다. blocked 상태이므로 즉각 실행 압박은 없으나, 해제 조건과 설계 완성도를 높여야 blocked 해제 후 바로 실행할 수 있다.

---

## Test Plan

이 문서는 리뷰/분석 문서이며 구현 변경 없음. 리뷰 완성도 검증:

- 원본 태스크 파일(INFRA-BL-009-build-tool-migration.md)을 참조해 각 섹션의 지적 사항이 실제 누락 항목과 일치하는지 확인
- 종합 리뷰(review-INFRA-BL-009-synthesis.md)의 결론과 일관성 확인
- `pnpm harness:scan` 실행 시 이 파일이 scan 대상에 포함되어 오류 없이 통과하는지 확인
