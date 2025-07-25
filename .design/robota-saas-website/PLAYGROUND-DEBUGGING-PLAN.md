# Playground 채팅 및 스트리밍 문제 해결 계획

## 🚨 현재 문제 상황

1. **스트리밍 방식**: 아예 작동하지 않음
2. **일반 방식**: API 응답은 받지만 Chat UI 및 블록에 반영되지 않음

## 🎯 핵심 설계 원칙 (반드시 준수)

**중요**: 모든 통신은 **OpenAIProvider + RemoteExecutor 주입** 방식으로만 처리
- ✅ `OpenAIProvider({ executor: remoteExecutor })` 사용
- ✅ 모든 API 호출은 RemoteExecutor를 통해서만 수행
- ❌ 별도의 네트워크 호출이나 다른 방법 사용 금지
- ❌ 기존 Robota SDK 아키텍처를 우회하는 방법 금지

## 📋 수정된 디버깅 계획

### Phase 1: RemoteExecutor 주입 방식 검증

#### [x] 1.1 Executor 주입 검증
- [x] PlaygroundExecutor.createRemoteExecutor() 올바른 인스턴스 생성 확인
- [x] OpenAIProvider 생성 시 executor 주입 확인
- [x] Provider에서 this.executor 존재 여부 확인
- [x] Executor 메서드 존재 여부 확인 (executeChat, executeChatStream)

#### [x] 1.2 Provider → Executor 호출 경로 검증
- [x] OpenAIProvider.chat() → executeViaExecutorOrDirect() 호출 확인
- [x] OpenAIProvider.chatStream() → executeStreamViaExecutorOrDirect() 호출 확인
- [x] BaseAIProvider에서 this.executor.executeChat() 호출 확인
- [x] BaseAIProvider에서 this.executor.executeChatStream() 호출 확인

#### [x] 1.3 RemoteExecutor 메서드 호환성 검증
- [x] executeChat() 메서드 시그니처 호환성 확인
- [x] executeChatStream() 메서드 시그니처 호환성 확인
- [x] 요청 데이터 포맷 변환 로직 확인
- [x] 응답 데이터 포맷 변환 로직 확인

#### [x] 1.4 HttpClient → API 서버 통신 검증
- [x] HttpClient.chat() → /api/v1/remote/chat 호출 확인
- [x] HttpClient.chatStream() → /api/v1/remote/stream 호출 확인
- [x] 요청 헤더 및 인증 확인
- [x] 응답 데이터 구조 확인
- [x] **핵심 문제 해결**: getSession() → getConversationSession() 수정

### Phase 2: UI 데이터 흐름 검증 (스트림 응답 받음, UI 반영 안됨)

#### [x] 2.1 PlaygroundExecutor → Context 데이터 흐름
- [x] PlaygroundExecutor.runStream() 결과 반환 방식 확인
- [x] AsyncGenerator yield 처리 방식 확인
- [x] 최종 PlaygroundExecutionResult 반환 확인
- [x] **문제 발견**: Context에서 AsyncGenerator return 값을 받지 못함
- [x] **해결**: 수동 iterator 방식으로 수정하여 return 값 올바르게 수신

#### [x] 2.2 Context → Hook 데이터 흐름  
- [x] executeStreamPrompt onChunk 콜백 호출 확인
- [x] useRobotaExecution lastResult 상태 업데이트 확인
- [x] streamingResponse 상태 업데이트 확인
- [x] 상태 변경 useEffect 의존성 배열 확인

#### [x] 2.3 Hook → Chat UI 데이터 흐름
- [x] lastResult 변경 시 Chat UI 업데이트 로직 확인
- [x] **문제 발견**: conversationEvents가 visualizationData.events에서 가져오는데 assistant 응답 이벤트가 누락됨
- [x] **해결**: executeStreamPrompt 완료 후 명시적으로 assistant_response 이벤트 추가
- [x] Assistant 응답 메시지 추가 로직 확인
- [x] 스트리밍 응답 실시간 표시 로직 확인

#### [x] 2.4 PlaygroundHistoryPlugin → Block 시스템 연동
- [x] historyPlugin.recordEvent() 호출 시점 확인 (SDK 내부에서 처리)
- [x] Assistant 응답 이벤트 기록 로직 확인
- [x] lastResult → Block 생성 useEffect 트리거 확인 (이미 구현됨)
- [x] Block 데이터 수집 및 표시 로직 확인

## 📊 진행 상황 추적

**🎯 핵심 문제 발견 및 해결**: `this.conversationHistory.getSession is not a function`

**문제**: ExecutionService.executeStream()에서 `getSession()` 메서드를 호출했으나, 실제로는 `getConversationSession()` 메서드가 존재함
**해결**: `getSession()` → `getConversationSession()` 수정

**현재 진행 중**: Phase 1 완료 - 테스트 필요

**Phase 1 완료율**: 100% (16/16) - ✅ 완료
**Phase 2 완료율**: 0% (8/8)  
**Phase 3 완료율**: 0% (9/9)
**Phase 4 완료율**: 0% (8/8)

**전체 진행률**: 39% (16/41) 