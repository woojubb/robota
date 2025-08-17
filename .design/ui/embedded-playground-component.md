# Embedded Playground Component Development Plan

## 프로젝트 개요

홈페이지 곳곳에서 사용할 수 있는 독립적인 playground 컴포넌트를 개발합니다. 이 컴포넌트는 syntax highlighting이 적용된 코드 에디터와 실행 기능을 가진 sandbox 환경을 제공합니다.

## 목표

- 재사용 가능한 독립적인 playground 컴포넌트
- Monaco Editor 기반 syntax highlighting
- **최소한의 UI (코드 + 실행 버튼)를 기본으로 한 심플한 디자인**
- 코드 실행 및 결과 표시 기능
- **플레이그라운드 페이지로의 연동 기능 (고급 기능 제공)**
- 다양한 크기와 설정으로 홈페이지 곳곳에 임베드 가능
- 반응형 디자인 지원

## 🎨 UI 설계 원칙

### 기본 UI (Minimal Mode)
- **코드 에디터 + 실행 버튼**만을 포함한 최소한의 인터페이스
- 불필요한 UI 요소 제거로 집중도 향상
- 심플하고 깔끔한 디자인

### 확장 UI (Extended Mode)
- 추가 버튼들 (복사, 리셋, 전체화면 등)
- 템플릿 선택기
- 설정 패널
- **"Playground에서 열기" 버튼**

---

## Phase 1: 컨테이너 및 기본 구조 설계

### 1.1 컴포넌트 아키텍처 설계
- [ ] 독립적인 `EmbeddedPlayground` 컴포넌트 구조 설계
- [ ] Props 인터페이스 정의 (크기, 테마, 초기 코드, 설정 등)
- [ ] **UI 모드 설정 (`minimal` | `extended`) 지원**
- [ ] 컴포넌트 상태 관리 설계 (코드, 실행 결과, 로딩 상태)
- [ ] 타입 정의 파일 생성 (`types/embedded-playground.ts`)

### 1.2 컨테이너 레이아웃 구성
- [ ] 기본 컨테이너 구조 생성 (`components/embedded-playground/`)
- [ ] **최소 UI 모드: 코드 에디터 + 실행 버튼만 포함**
- [ ] **확장 UI 모드: 헤더 영역 (제목, 추가 버튼들, 옵션 메뉴)**
- [ ] 코드 에디터 영역
- [ ] 결과 출력 영역 (최소 모드에서는 간소화)
- [ ] 반응형 레이아웃 구현 (데스크톱/모바일)

### 1.3 기본 스타일링
- [ ] **최소 UI를 위한 심플한 디자인 시스템**
- [ ] CSS 모듈 또는 Tailwind 기반 스타일링
- [ ] 다크/라이트 테마 지원
- [ ] 크기 변형 지원 (small, medium, large, custom)
- [ ] **최소/확장 모드 간 부드러운 전환 애니메이션**

---

## Phase 2: Monaco Editor 통합

### 2.1 Monaco Editor 설정
- [ ] Monaco Editor 래퍼 컴포넌트 생성
- [ ] TypeScript 언어 지원 설정
- [ ] 읽기 전용/편집 가능 모드 전환
- [ ] 자동 완성 및 IntelliSense 설정

### 2.2 Syntax Highlighting 최적화
- [ ] Robota SDK 타입 정의 추가
- [ ] 커스텀 테마 설정 (브랜드 컬러 적용)
- [ ] 에러 표시 및 문법 검사
- [ ] 코드 포맷팅 기능

### 2.3 편집 기능
- [ ] 코드 복사/붙여넣기 기능
- [ ] 실행 단축키 (Ctrl+Enter)
- [ ] 코드 리셋 기능
- [ ] 전체화면 모드

---

## Phase 3: 코드 실행 엔진

### 3.1 Sandbox 실행 환경
- [ ] 안전한 코드 실행 환경 구축
- [ ] Robota SDK 모의 실행 시스템
- [ ] 실행 시간 제한 및 메모리 관리
- [ ] 에러 핸들링 및 예외 처리

### 3.2 결과 출력 시스템
- [ ] 실행 결과 표시 컴포넌트
- [ ] 콘솔 로그 캡처 및 표시
- [ ] 에러 메시지 포맷팅
- [ ] 실행 통계 (시간, 메모리 사용량)

### 3.3 실행 상태 관리
- [ ] 로딩 인디케이터
- [ ] 실행 취소 기능
- [ ] 실행 히스토리 관리
- [ ] 결과 캐싱 시스템

---

## Phase 4: 고급 기능

### 4.1 템플릿 시스템
- [ ] 미리 정의된 코드 템플릿
- [ ] 템플릿 선택 드롭다운
- [ ] 커스텀 템플릿 추가 기능
- [ ] 템플릿 카테고리 분류

### 4.2 플레이그라운드 페이지 연동
- [ ] **"Playground에서 열기" 버튼 구현**
- [ ] **현재 코드를 URL 파라미터로 전달하는 기능**
- [ ] **플레이그라운드 페이지에서 임베드 코드 수신 및 로드**
- [ ] **코드 공유를 위한 고유 링크 생성**
- [ ] **임베드 → 플레이그라운드 간 상태 전달 시스템**

### 4.3 공유 및 내보내기
- [ ] 코드 공유 링크 생성
- [ ] 코드 스니펫 복사 기능
- [ ] 이미지로 내보내기
- [ ] 임베드 코드 생성

### 4.4 설정 및 커스터마이징
- [ ] 에디터 설정 패널 (폰트 크기, 테마 등)
- [ ] 단축키 커스터마이징
- [ ] 플러그인 시스템 (선택적 기능 활성화)
- [ ] 사용자 환경설정 저장

---

## Phase 5: 통합 및 배포

### 5.1 홈페이지 통합
- [ ] 메인 페이지 데모 섹션 교체
- [ ] 문서 페이지에 인라인 예제 추가
- [ ] 블로그 포스트용 임베드 버전
- [ ] API 문서 인터랙티브 예제

### 5.2 성능 최적화
- [ ] 코드 스플리팅 및 지연 로딩
- [ ] 번들 크기 최적화
- [ ] 메모리 누수 방지
- [ ] 렌더링 성능 최적화

### 5.3 테스팅 및 품질 보증
- [ ] 단위 테스트 작성
- [ ] 통합 테스트
- [ ] 접근성 테스트
- [ ] 브라우저 호환성 테스트

---

## 컴포넌트 API 설계 (예시)

```typescript
interface EmbeddedPlaygroundProps {
  // 기본 설정
  initialCode?: string
  language?: 'typescript' | 'javascript' | 'python'
  theme?: 'light' | 'dark' | 'auto'
  size?: 'small' | 'medium' | 'large' | { width: string; height: string }
  
  // UI 모드 설정
  mode?: 'minimal' | 'extended'
  
  // 기능 설정 (minimal 모드에서는 제한적)
  readOnly?: boolean
  showExecuteButton?: boolean // 기본값: true
  showCopyButton?: boolean    // extended 모드에서만
  showFullscreenButton?: boolean // extended 모드에서만
  showPlaygroundButton?: boolean // "Playground에서 열기" 버튼
  enableTemplates?: boolean   // extended 모드에서만
  
  // 실행 설정
  timeout?: number
  enableConsoleOutput?: boolean
  mockApiResponses?: Record<string, any>
  
  // 스타일링
  className?: string
  headerTitle?: string // extended 모드에서만 표시
  placeholder?: string
  
  // 플레이그라운드 연동
  playgroundUrl?: string // 기본값: '/playground'
  enableUrlSharing?: boolean
  
  // 이벤트 핸들러
  onCodeChange?: (code: string) => void
  onExecute?: (code: string, result: any) => void
  onError?: (error: Error) => void
  onOpenPlayground?: (code: string) => void
}
```

## 사용 예시

```tsx
// 메인 페이지 데모 섹션 (최소 UI)
<EmbeddedPlayground
  initialCode={demoCode}
  size="large"
  mode="minimal"
  showPlaygroundButton
  playgroundUrl="/playground"
/>

// 문서 페이지 인라인 예제 (최소 UI + 플레이그라운드 연동)
<EmbeddedPlayground
  initialCode={exampleCode}
  size="medium"
  mode="minimal"
  readOnly
  showPlaygroundButton
  theme="auto"
/>

// 블로그 포스트 임베드 (초간단 버전)
<EmbeddedPlayground
  initialCode={snippetCode}
  size="small"
  mode="minimal"
  showExecuteButton={false}
/>

// 고급 기능이 필요한 경우 (확장 UI)
<EmbeddedPlayground
  initialCode={complexCode}
  size="large"
  mode="extended"
  headerTitle="Advanced Example"
  enableTemplates
  showCopyButton
  showFullscreenButton
  showPlaygroundButton
/>
```

## 플레이그라운드 페이지 연동 플로우

```
1. 사용자가 임베드 컴포넌트에서 코드 작성/수정
   ↓
2. "Playground에서 열기" 버튼 클릭
   ↓
3. 현재 코드를 URL 파라미터로 인코딩
   ↓
4. /playground?code=${encodedCode} 로 이동
   ↓
5. 플레이그라운드 페이지에서 코드 디코딩 후 로드
   ↓
6. 플레이그라운드에서 고급 기능 사용 가능
```

---

## 예상 파일 구조

```
src/components/embedded-playground/
├── index.ts                          # 메인 export
├── embedded-playground.tsx           # 메인 컴포넌트
├── components/
│   ├── code-editor.tsx              # Monaco Editor 래퍼
│   ├── execution-panel.tsx          # 실행 결과 패널
│   ├── minimal-header.tsx           # 최소 UI용 헤더 (실행 버튼만)
│   ├── extended-header.tsx          # 확장 UI용 헤더 (제목, 버튼들)
│   ├── playground-button.tsx        # "Playground에서 열기" 버튼
│   ├── template-selector.tsx        # 템플릿 선택기 (extended 모드)
│   └── settings-panel.tsx           # 설정 패널 (extended 모드)
├── hooks/
│   ├── use-code-execution.ts        # 코드 실행 로직
│   ├── use-template-manager.ts      # 템플릿 관리
│   ├── use-playground-integration.ts # 플레이그라운드 연동 로직
│   └── use-playground-state.ts      # 상태 관리
├── types/
│   └── index.ts                     # 타입 정의
├── utils/
│   ├── code-executor.ts             # 코드 실행 엔진
│   ├── syntax-highlighter.ts       # Syntax highlighting 설정
│   ├── url-encoder.ts               # 코드 URL 인코딩/디코딩
│   └── template-presets.ts          # 기본 템플릿들
└── styles/
    ├── minimal.css                  # 최소 UI 스타일
    ├── extended.css                 # 확장 UI 스타일
    └── embedded-playground.css      # 공통 스타일
```

---

## 개발 일정 (예상)

- **Phase 1**: 3-4일 (컨테이너 및 기본 구조)
- **Phase 2**: 2-3일 (Monaco Editor 통합)
- **Phase 3**: 4-5일 (코드 실행 엔진)
- **Phase 4**: 3-4일 (고급 기능)
- **Phase 5**: 2-3일 (통합 및 최적화)

**총 예상 기간**: 14-19일

---

## 확인 사항

이 계획서를 검토하시고 다음 사항에 대해 피드백을 주세요:

1. **우선순위**: 어떤 기능을 먼저 구현해야 할까요?
2. **기능 범위**: 추가하고 싶은 기능이나 제외할 기능이 있나요?
3. **기술 스택**: Monaco Editor 외에 다른 라이브러리 사용에 대한 의견
4. **디자인 요구사항**: 특별한 UI/UX 요구사항이 있나요?
5. **성능 요구사항**: 특별히 신경 써야 할 성능 지표가 있나요?

승인해주시면 Phase 1 (컨테이너 역할을 하는 playground) 개발을 시작하겠습니다. 