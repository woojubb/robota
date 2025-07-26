# Team Hooks 구현 통합 체크리스트

## 🎯 목표
Team 실행 시 assignTask 도구 호출을 Hook으로 추적하여 계층적 이벤트 구조 생성

## 📋 구현 체크리스트

### Phase 1: Team 패키지 toolHooks 지원 추가

#### [x] 1.1 TeamContainerOptions 인터페이스 확장
- [x] `packages/team/src/types.ts`에서 `TeamContainerOptions`에 `toolHooks?: ToolHooks` 추가
- [x] ToolHooks import 및 타입 정의 확인
- [x] **검증**: 컴파일 오류 없음

#### [x] 1.2 createTeam 함수 수정
- [x] `packages/team/src/create-team.ts`에서 `options.toolHooks`를 `TeamContainerOptions`로 전달
- [x] fullOptions 객체에 toolHooks 추가: `...(options.toolHooks && { toolHooks: options.toolHooks })`
- [x] **검증**: createTeam 호출 시 toolHooks 옵션 인식

#### [x] 1.3 TeamContainer 생성자 수정
- [x] `packages/team/src/team-container.ts`에서 `private toolHooks?: ToolHooks` 필드 추가
- [x] constructor에서 `this.toolHooks = options.toolHooks` 설정
- [x] **검증**: TeamContainer 인스턴스에 toolHooks 저장됨

#### [x] 1.4 createAssignTaskTool 메서드 수정
- [x] 조건부 로직 추가: `if (this.toolHooks)` 분기
- [x] toolHooks 있으면 `AgentDelegationTool` 생성, 없으면 기존 `createTaskAssignmentFacade` 사용
- [x] AgentDelegationTool 생성 시 필요한 옵션들 전달
- [x] **검증**: toolHooks 유무에 따른 도구 생성 방식 분기

### Phase 2: Playground toolHooks 연동

#### [x] 2.1 PlaygroundExecutor.createTeam 수정
- [x] `apps/web/src/lib/playground/robota-executor.ts`에서 `createAssignTaskHooks` 함수 호출
- [x] `createTeam` 호출 시 `toolHooks: createAssignTaskHooks(this.historyPlugin)` 옵션 추가
- [x] **검증**: createTeam에 toolHooks 전달됨

#### [x] 2.2 createAssignTaskHooks 함수 정리
- [x] 기존 Hook 팩토리 함수 검토 및 정리
- [x] assignTask 도구에 특화된 이벤트 기록 로직 유지
- [x] delegationId, parentEventId 추적 로직 확인
- [x] **검증**: Hook 함수들이 올바른 이벤트 생성

### Phase 3: 통합 테스트 및 검증

#### [ ] 3.1 기본 동작 테스트
- [ ] 웹 앱 실행 후 Team 모드로 간단한 프롬프트 테스트
- [ ] assignTask Hook이 실행되는지 콘솔 로그 확인
- [ ] **검증**: Hook의 beforeExecute, afterExecute 호출 확인

#### [ ] 3.2 계층 구조 확인
- [ ] Block Visualization Panel에서 Level 0 (Team), Level 1 (assignTask) 이벤트 표시 확인
- [ ] 들여쓰기로 계층 구조 표현되는지 확인
- [ ] executionPath가 'team→assignTask' 형태로 표시되는지 확인
- [ ] **검증**: 계층적 UI 표시 정상 동작

#### [ ] 3.3 하위 호환성 검증
- [ ] toolHooks 없이 createTeam 호출해도 정상 동작하는지 확인
- [ ] 기존 Team 라이브러리 사용자에게 영향 없는지 확인
- [ ] **검증**: 기존 방식으로도 Team 실행 가능

#### [ ] 3.4 에러 처리 확인
- [ ] assignTask 실행 중 오류 발생 시 Hook의 onError 호출 확인
- [ ] 에러 이벤트가 올바른 계층에 기록되는지 확인
- [ ] **검증**: 에러 시나리오에서도 안정적 동작

### Phase 4: 문서 정리 및 마무리

#### [ ] 4.1 관련 문서 정리
- [ ] SIMPLIFIED-TEAM-EVENTS-PLAN.md에서 완료된 항목 체크
- [ ] PLUGIN-ARCHITECTURE-FIX-PLAN.md에서 완료된 항목 체크
- [ ] 불필요한 중복 체크리스트 제거
- [ ] **검증**: 문서 상태가 실제 구현과 일치

#### [ ] 4.2 GitHub 커밋 및 푸시
- [ ] 모든 변경사항 git add
- [ ] 의미있는 커밋 메시지로 커밋
- [ ] develop 브랜치에 푸시
- [ ] **검증**: 코드 변경사항이 원격 저장소에 반영

## 🎯 성공 기준

**기술적 달성 목표**:
- ✅ Team 실행 시 assignTask Hook 자동 실행
- ✅ Level 0 (Team) → Level 1 (assignTask) 계층 구조 표시
- ✅ 기존 Team 라이브러리 하위 호환성 유지
- ✅ toolHooks 옵션을 통한 표준화된 Hook 주입 방법 제공

**사용자 경험 달성 목표**:
- ✅ Block Visualization Panel에서 계층적 들여쓰기 표시
- ✅ assignTask 도구 호출 시작/완료가 명확히 구분
- ✅ Team 실행 과정의 시각적 추적 가능
- ✅ 복잡한 Sub-Agent 세부사항은 숨김 (단순화)

## 📊 진행 상황
- [ ] Phase 1: Team 패키지 수정 (0/4 완료)
- [ ] Phase 2: Playground 연동 (0/2 완료)  
- [ ] Phase 3: 테스트 및 검증 (0/4 완료)
- [ ] Phase 4: 문서 정리 (0/2 완료)

**전체 진행률**: 0/12 (0%) 