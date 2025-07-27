# Robota SaaS Website 설계 문서

## 📋 프로젝트 개요

**Robota SaaS Website**는 사용자가 웹 브라우저에서 직접 AI Agent와 Team을 구성하고 실행할 수 있는 플랫폼입니다. 복잡한 설정 없이 드래그 앤 드롭과 시각적 인터페이스를 통해 AI 에이전트를 만들고 테스트할 수 있습니다.

## 🎯 핵심 목표

### 1. **직관적인 Agent 구성**
- 코드 작성 없이 Agent 설정 가능
- 다양한 AI 모델 (OpenAI, Anthropic, Google) 지원
- 실시간 설정 변경 및 테스트

### 2. **완전한 실행 추적**
- Team/Agent/Tool 모든 실행 단계 시각화
- 계층 구조 기반 블록 시스템
- EventService 아키텍처로 통합 이벤트 처리

### 3. **사용자 중심 SaaS 플랫폼**
- Firebase 기반 사용자 인증 및 관리
- 크레딧 기반 사용량 제한 시스템
- Stripe 연동 구독 및 결제

## 🏗️ 아키텍처 개요

### 프론트엔드 스택
- **Next.js 14** - React 기반 풀스택 프레임워크
- **TypeScript** - 타입 안전성 확보
- **Tailwind CSS** - 반응형 디자인
- **Radix UI** - 접근성 중심 컴포넌트

### 백엔드 & 인프라
- **Firebase** - 인증, 데이터베이스, 호스팅
- **Vercel** - 배포 및 서버리스 함수
- **Stripe** - 결제 시스템
- **Sentry** - 에러 추적

### AI 통합
- **Robota SDK** - Agent/Team 실행 엔진
- **RemoteExecutor** - 브라우저에서 AI 모델 호출
- **EventService** - 통합 이벤트 추적 시스템

## �� 문서 구조

### 🎯 현재 작업 (최우선)
- **[EVENTSERVICE-IMPLEMENTATION-TASKS.md](./EVENTSERVICE-IMPLEMENTATION-TASKS.md)** - EventService 구현 전체 작업 목록
- **[ROADMAP.md](./ROADMAP.md)** - 전체 개발 일정 및 마일스톤

### 🏗️ 아키텍처 문서
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - 전체 시스템 아키텍처
- **[02-tech-stack-architecture.md](./02-tech-stack-architecture.md)** - 기술 스택 상세 설명

### 🎨 UI/UX 설계
- **[03-ui-ux-design.md](./03-ui-ux-design.md)** - 전체 UI/UX 설계
- **[06-playground-design.md](./06-playground-design.md)** - Playground 상세 설계

### 🔧 기능별 설계
- **[04-authentication-system.md](./04-authentication-system.md)** - Firebase 인증 시스템
- **[05-api-usage-management.md](./05-api-usage-management.md)** - 크레딧 및 사용량 관리
- **[07-firebase-backend-design.md](./07-firebase-backend-design.md)** - Firebase 백엔드 설계

### 📊 기타 문서
- **[FEATURES.md](./FEATURES.md)** - 핵심 기능 목록
- **[08-development-roadmap.md](./08-development-roadmap.md)** - 개발 가이드라인

## 🚀 현재 개발 상태

### ✅ 완료된 기능
- [x] **Playground 기본 구조** - Agent/Team 모드 전환
- [x] **RemoteExecutor 통합** - 브라우저에서 AI 모델 호출
- [x] **기본 블록 시스템** - 대화 내역 시각화
- [x] **PlaygroundHistoryPlugin** - 이벤트 추적 기반 구조

### 🔄 진행 중
- [ ] **EventService 아키텍처** - Team/Agent/Tool 통합 이벤트 시스템
- [ ] **계층 구조 시각화** - assignTask 도구 호출 완전 추적

### 📋 다음 단계
1. **EventService 핵심 구현** (7-10일)
2. **Firebase 인증 시스템** (5-7일)  
3. **크레딧 기반 사용량 관리** (7-10일)
4. **UI/UX 최적화** (5-7일)

## 🎯 EventService 아키텍처 (현재 핵심)

### 핵심 설계 원칙
- **Built-in Service**: ExecutionService와 동일한 패턴
- **단순한 인터페이스**: `emit(eventType, data)` 메소드만
- **의존성 주입**: Optional EventService로 유연성 확보
- **아키텍처 일관성**: 기존 Robota SDK 패턴과 100% 일치

### 주요 구현 사항
```typescript
// EventService 인터페이스
interface EventService {
  emit(eventType: EventType, data: EventData): void;
}

// Agent/Team에서 사용
class Robota {
  constructor(config: AgentConfig) {
    this.eventService = config.eventService || new SilentEventService();
  }
}

// Playground에서 구현
class PlaygroundEventService implements EventService {
  emit(eventType: EventType, data: EventData): void {
    // UI 블록으로 변환하여 실시간 표시
  }
}
```

## 🎨 UI 미리보기

### Playground 인터페이스
- **왼쪽 패널**: Agent/Team 설정 및 구성
- **중앙 패널**: 대화 인터페이스 및 실행 결과
- **오른쪽 패널**: 실행 과정 블록 시각화

### 블록 시각화 예시
```
📦 Team 실행
├── 💬 사용자: "Vue와 React 비교해줘"
├── 🔧 assignTask #1: Vue 분석
│   ├── 👤 Vue 전문가 Agent
│   ├── 🔍 웹 검색 도구
│   └── ✅ 분석 완료
├── 🔧 assignTask #2: React 분석  
│   ├── 👤 React 전문가 Agent
│   ├── 🔍 웹 검색 도구
│   └── ✅ 분석 완료
└── 💭 최종 비교 결과
```

## 📊 성공 지표

### 기술적 목표
- [ ] Team 모드 assignTask 100% 추적
- [ ] 사용자 인증 성공률 99% 이상
- [ ] API 응답 시간 < 500ms
- [ ] 크레딧 계산 정확도 100%

### 사용자 경험 목표
- [ ] 코드 작성 없이 복잡한 AI Agent 구성
- [ ] 모든 실행 과정 실시간 시각화
- [ ] 직관적이고 반응성 좋은 인터페이스
- [ ] 안정적인 결제 및 사용량 관리

## 🚀 시작하기

### 개발 환경 설정
```bash
# 프로젝트 클론
git clone [repository-url]
cd robota-saas-website

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env.local

# 개발 서버 시작
npm run dev
```

### 주요 명령어
```bash
npm run dev          # 개발 서버 시작
npm run build        # 프로덕션 빌드
npm run test         # 테스트 실행
npm run lint         # 코드 품질 검사
```

## 🤝 기여하기

### 개발 워크플로우
1. **이슈 확인**: GitHub Issues에서 작업할 내용 확인
2. **브랜치 생성**: `feature/[기능명]` 또는 `fix/[버그명]`
3. **개발 진행**: 변경사항 구현 및 테스트
4. **Pull Request**: 코드 리뷰 요청
5. **병합**: 승인 후 메인 브랜치에 병합

### 코드 스타일
- **TypeScript** 엄격 모드 사용
- **ESLint + Prettier** 자동 포맷팅
- **컴포넌트** 명명: PascalCase
- **함수/변수** 명명: camelCase

## 📞 연락처

- **프로젝트 관리**: GitHub Issues
- **기술 지원**: 개발팀 Discord
- **문서 개선**: Pull Request 환영

---

**업데이트**: 2025-01-28  
**상태**: EventService 구현 중  
**다음 마일스톤**: 2025-02-07 (EventService 완성) 