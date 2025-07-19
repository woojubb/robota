# 🎨 Design & Planning 문서

Robota SDK 프로젝트의 설계 문서와 계획서들을 카테고리별로 정리한 폴더입니다.

## 📁 폴더 구조

### 🔧 **worker-system/**
Worker 실행 시스템 관련 설계 문서
- WorkerWrapper 개발 계획
- Worker 아키텍처 설계
- 크로스 플랫폼 지원 계획

### 🎨 **ui-components/**
사용자 인터페이스 컴포넌트 설계 문서
- Playground 컴포넌트 설계
- 임베디드 컴포넌트 계획
- UI/UX 설계 문서

### 🚀 **deployment/**
배포 및 릴리스 관련 문서
- npm 배포 체크리스트
- CI/CD 설정 계획
- 버전 관리 전략

### 📋 **implementation/**
구현 관련 계획 및 체크리스트
- 기능 구현 계획서
- 개발 체크리스트
- 코드 리뷰 가이드라인

### 🌐 **client-compatibility/**
클라이언트 호환성 관련 문서
- 브라우저 호환성 계획
- 플랫폼별 지원 전략

### 🖥️ **robota-saas-website/**
Robota SaaS 웹사이트 관련 설계
- 웹사이트 아키텍처
- 기능 명세서
- UI/UX 설계

### 📝 **planning/**
전체적인 프로젝트 계획 문서
- 로드맵
- 우선순위 계획
- 리소스 할당 계획

### 🔌 **plugin-module-separation/**
플러그인 및 모듈 분리 설계
- 모듈 아키텍처
- 플러그인 시스템 설계
- 의존성 분리 전략

### 🌐 **remote-system/**
원격 실행 시스템 설계 문서
- Remote AI Provider 아키텍처
- Provider 의존성 주입 아키텍처 (ExecutorInterface)
- 아키텍처 방식 비교 분석 (Executor vs RemoteProviders)
- 플레이그라운드 실행 전략 (투명한 원격 실행)
- 플레이그라운드 Provider 교체 전략 (방안 1 상세 구현)
- 간소화된 플레이그라운드 전략 (BaseAIProvider executor 주입)
- 현재 vs 제안된 Provider 설계 비교 (Client vs Executor 주입)
- 모델 설정 중복 문제 분석 및 해결 방안
- 런타임 모델 전환 기능 분석: Provider 설계 재검토
- 서버-클라이언트 통신 설계
- API Key 보안 및 권한 관리
- 사용량 추적 및 비용 제어

### 🔧 **model-configuration-refactoring/**
모델 설정 리팩토링 프로젝트 문서
- 프로젝트 체크리스트 및 실행 계획
- 사용자 마이그레이션 가이드

## 📝 문서 작성 규칙

1. **명확한 제목**: 문서의 목적을 명확히 표현
2. **구조화된 내용**: 섹션별로 체계적으로 정리
3. **실행 가능한 계획**: 구체적인 실행 단계 포함
4. **업데이트 이력**: 중요한 변경사항 기록
5. **한국어 작성**: 개발팀 내부 문서는 한국어로 작성

## 🔄 문서 관리

- 새로운 설계 문서는 적절한 카테고리 폴더에 배치
- 문서명은 `kebab-case` 형식으로 작성
- 완료된 계획은 `COMPLETED_` 접두사 추가
- 더 이상 사용하지 않는 문서는 `DEPRECATED_` 접두사 추가 