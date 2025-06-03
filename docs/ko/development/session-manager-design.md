---
title: SessionManager 설계 문서
description: Robota 세션 및 채팅 관리를 위한 SessionManager 설계 및 구현 계획
lang: ko-KR
date: 2024-12-XX
---

# SessionManager 설계 문서

이 문서는 Robota 프로젝트의 SessionManager 개발을 위한 전체적인 설계와 구현 계획을 다룹니다.

## ✅ 완료된 작업

### Phase 1: 프로젝트 기본 구조 생성 ✅
- [x] 패키지 디렉토리 구조 생성
- [x] package.json, tsconfig.json, tsup.config.ts 설정
- [x] 기본 타입 정의 (SessionManager, Session, ChatInstance, Storage, Events)
- [x] Enhanced ConversationHistory 구현
- [x] ChatInstance 기본 구현
- [x] 빌드 시스템 설정 완료

### Phase 2: 핵심 클래스 구현 ✅
- [x] Session 클래스 완성 구현
- [x] SessionManager 클래스 기본 구현 
- [x] 세션 생성/조회/삭제 기능
- [x] 채팅 관리 및 전환 기능
- [x] 간단한 메모리 관리 및 통계

## 🎯 핵심 요구사항 (간소화)

1. **멀티 세션 관리**: 사용자별로 독립적인 작업 공간(Session) 관리
2. **세션 내 채팅 관리**: 하나의 세션에서 여러 채팅 히스토리 보관 및 전환  
3. **단일 활성 채팅**: 세션 내에서 한 번에 하나의 채팅만 활성화
4. **세션 격리**: 세션 간 완전한 독립성 보장

### 개념 구조
```
User (사용자)
├── Session A (작업 공간 1)
│   ├── Chat 1 (활성) ← 현재 대화 중
│   ├── Chat 2 (비활성) 
│   └── Chat 3 (비활성)
├── Session B (작업 공간 2)
│   ├── Chat 1 (활성) ← 이 세션의 현재 채팅
│   └── Chat 2 (비활성)
```

## 🏗️ 간소화된 아키텍처

```
@robota-sdk/sessions
├── SessionManager (세션 관리자)
│   ├── Session A (작업 공간)
│   │   ├── ChatInstance 1 (활성) - Robota + Enhanced History
│   │   ├── ChatInstance 2 (비활성)
│   │   └── ChatInstance 3 (비활성)
│   ├── Session B
│   │   ├── ChatInstance 1 (활성)
│   │   └── ChatInstance 2 (비활성)
```

## 💡 기본 사용 예시

```typescript
import { SessionManagerImpl } from '@robota-sdk/sessions';
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';

// 1. SessionManager 초기화
const sessionManager = new SessionManagerImpl({
  maxActiveSessions: 10
});

// 2. 새 세션(작업 공간) 생성
const workSession = await sessionManager.createSession('user123', {
  sessionName: 'Python Development'
});

// 3. 첫 번째 채팅 생성 (자동으로 활성화됨)
const debugChat = await workSession.createNewChat({
  chatName: 'Debug Session',
  robotaConfig: {
    aiProviders: { openai: new OpenAIProvider({ /* config */ }) },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
  }
});

// 4. 채팅 시작
await debugChat.sendMessage('Help me debug this Python error: ...');

// 5. 같은 세션에서 새 채팅 생성
const featureChat = await workSession.createNewChat({
  chatName: 'Feature Development'
});
// featureChat이 활성화되고, debugChat은 비활성화됨

// 6. 이전 채팅으로 전환
await workSession.switchToChat(debugChat.metadata.chatId);
await debugChat.sendMessage('Continue debugging...');
```

## 📅 남은 구현 계획

### Phase 3: 간단한 저장소 구현 (우선순위: ⚡)
- [ ] MemoryStorage 구현체
- [ ] 기본 pause/resume 기능

### Phase 4: 예제 및 문서화 (우선순위: ⚡)  
- [ ] 기본 사용법 예제
- [ ] 패키지 README.md 작성

### Phase 5: 테스트 (우선순위: ⚡)
- [ ] 기본 유닛 테스트
- [ ] 통합 테스트

**총 예상 소요시간**: 2-3주

---

*마지막 업데이트: 2024년 12월* 