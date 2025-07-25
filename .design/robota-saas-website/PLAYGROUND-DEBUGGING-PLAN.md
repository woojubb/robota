# Playground 채팅 및 스트리밍 문제 해결 계획

## 🚨 현재 문제 상황

1. **스트리밍 방식**: 아예 작동하지 않음
2. **일반 방식**: API 응답은 받지만 Chat UI 및 블록에 반영되지 않음

## 📋 체계적 디버깅 계획

### Phase 1: 근본 원인 분석 및 데이터 흐름 추적

#### [ ] 1.1 API 레벨 검증
- [ ] 일반 API (`/api/v1/remote/chat`) 호출 성공 여부 확인
- [ ] 스트리밍 API (`/api/v1/remote/stream`) 호출 성공 여부 확인
- [ ] API 응답 데이터 구조 정확성 검증
- [ ] Network 탭에서 실제 호출되는 엔드포인트 확인

#### [ ] 1.2 RemoteExecutor 레벨 검증
- [ ] `executeChat()` 메서드 호출 여부 및 응답 확인
- [ ] `executeChatStream()` 메서드 호출 여부 및 응답 확인
- [ ] 요청 데이터 포맷 검증 (ChatExecutionRequest vs SimpleExecutionRequest)
- [ ] 응답 데이터 변환 로직 검증

#### [ ] 1.3 Provider 레벨 검증
- [ ] OpenAIProvider의 `chat()` 메서드 호출 확인
- [ ] OpenAIProvider의 `chatStream()` 메서드 호출 확인
- [ ] `executeViaExecutorOrDirect()` vs `executeStreamViaExecutorOrDirect()` 호출 경로 확인
- [ ] Executor 존재 여부 및 올바른 메서드 선택 검증

#### [ ] 1.4 ExecutionService 레벨 검증
- [ ] `execute()` vs `executeStream()` 메서드 호출 확인
- [ ] Provider 인스턴스 획득 및 호출 검증
- [ ] 대화 히스토리 추가 로직 확인
- [ ] 플러그인 hook 호출 확인

### Phase 2: UI 레벨 데이터 흐름 검증

#### [ ] 2.1 Context 레벨 데이터 흐름
- [ ] `PlaygroundProvider.executePrompt()` 호출 확인
- [ ] `PlaygroundProvider.executeStreamPrompt()` 호출 확인
- [ ] `state.executor.run()` vs `state.executor.runStream()` 호출 확인
- [ ] ExecutionResult 상태 업데이트 확인

#### [ ] 2.2 Hook 레벨 데이터 흐름
- [ ] `useRobotaExecution.executePrompt()` 호출 확인
- [ ] `useRobotaExecution.executeStreamPrompt()` 호출 확인
- [ ] `lastResult` 상태 업데이트 확인
- [ ] `streamingResponse` 상태 업데이트 확인

#### [ ] 2.3 Chat UI 레벨 데이터 흐름
- [ ] `useChatInput.sendMessage()` vs `sendStreamingMessage()` 호출 확인
- [ ] 사용자 메시지 추가 로직 확인
- [ ] Assistant 응답 추가 로직 확인
- [ ] `conversationEvents` 상태 업데이트 확인

#### [ ] 2.4 Block 시스템 레벨 데이터 흐름
- [ ] `PlaygroundHistoryPlugin.recordEvent()` 호출 확인
- [ ] 사용자 블록 생성 확인
- [ ] Assistant 응답 블록 생성 확인
- [ ] `lastResult` 변경 시 useEffect 실행 확인

### Phase 3: 특정 문제점 해결

#### [ ] 3.1 스트리밍 기능 수정
- [ ] API 서버 `/api/v1/remote/stream` 엔드포인트 동작 확인
- [ ] HttpClient.chatStream() SSE 파싱 로직 수정
- [ ] RemoteExecutor.executeChatStream() 호출 경로 수정
- [ ] 스트리밍 청크 데이터 UI 반영 로직 수정

#### [ ] 3.2 일반 채팅 UI 반영 수정
- [ ] API 응답 → Context 상태 업데이트 경로 수정
- [ ] Context 상태 → Chat UI 반영 경로 수정
- [ ] `lastResult` → Assistant 블록 생성 로직 수정
- [ ] 대화 히스토리 플러그인 이벤트 기록 로직 수정

#### [ ] 3.3 블록 시스템 연동 수정
- [ ] `PlaygroundHistoryPlugin` 이벤트 기록 타이밍 수정
- [ ] Block 데이터 수집 및 표시 로직 수정
- [ ] 실시간 블록 업데이트 메커니즘 수정

### Phase 4: 통합 테스트 및 검증

#### [ ] 4.1 기능별 단위 테스트
- [ ] 일반 채팅 (streaming off) 전체 흐름 테스트
- [ ] 스트리밍 채팅 (streaming on) 전체 흐름 테스트
- [ ] Agent 모드 vs Team 모드 테스트
- [ ] 에러 상황 핸들링 테스트

#### [ ] 4.2 UI/UX 검증
- [ ] 사용자 메시지 즉시 표시 확인
- [ ] Assistant 응답 표시 확인
- [ ] 스트리밍 실시간 업데이트 확인
- [ ] 블록 시각화 정확성 확인

## 🎯 예상 문제점 및 해결 방향

### 1. 스트리밍 문제
**예상 원인**: 
- API 서버 SSE 구현 문제
- HttpClient SSE 파싱 로직 오류
- 스트리밍 데이터 UI 반영 로직 누락

**해결 방향**:
- API 서버 스트리밍 엔드포인트 재검토
- fetch() + ReadableStream 기반 SSE 파싱 로직 수정
- 청크 단위 UI 업데이트 메커니즘 구현

### 2. Chat UI 반영 문제
**예상 원인**:
- Context 상태 업데이트 로직 오류
- useEffect 의존성 배열 문제
- 이벤트 기록 타이밍 문제

**해결 방향**:
- 전체 데이터 흐름 체인 재검토
- 상태 업데이트 순서 최적화
- 플러그인 이벤트 기록 로직 수정

### 3. 블록 시스템 연동 문제
**예상 원인**:
- PlaygroundHistoryPlugin 이벤트 기록 누락
- 블록 생성 조건 불일치
- lastResult 상태 변경 감지 실패

**해결 방향**:
- 플러그인 이벤트 기록 로직 강화
- 블록 생성 트리거 조건 명확화
- useEffect 의존성 및 조건 재검토

## 📊 진행 상황 추적

**Phase 1 완료율**: 0% (0/14)
**Phase 2 완료율**: 0% (0/12)  
**Phase 3 완료율**: 0% (0/9)
**Phase 4 완료율**: 0% (0/8)

**전체 진행률**: 0% (0/43)

## 🔄 검토 체크포인트

1. **Phase 1 완료 후**: 근본 원인 식별 및 문제 범위 확정
2. **Phase 2 완료 후**: UI 데이터 흐름 문제점 파악
3. **Phase 3 완료 후**: 핵심 기능 수정 완료
4. **Phase 4 완료 후**: 전체 시스템 동작 검증

각 Phase 완료 시 사용자 확인 후 다음 단계 진행. 